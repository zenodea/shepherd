import type {
  AgentInfo,
  CallMethod,
  ClientMessage,
  HostInfo,
  ServerMessage,
  StatusChange,
  TerminalMode,
} from "@sheperd/protocol";

export type ConnectionSettings = {
  /** Display name from pairing; the host's own name wins once connected. */
  name?: string;
  /**
   * Every address the host may be reachable on (LAN, Tailscale, relay). All
   * are tried at once and the first to answer is used.
   */
  urls: string[];
  token: string;
};

export type ConnectionStatus = "idle" | "connecting" | "online" | "offline" | "unauthorized";

export type HostState = {
  status: ConnectionStatus;
  error: string | null;
  host: HostInfo | null;
  /** The address currently in use. */
  activeUrl: string | null;
  agents: AgentInfo[];
};

export type TerminalFrame = Extract<ServerMessage, { type: "terminal.frame" }>;

export type TerminalHandlers = {
  onFrame: (frame: TerminalFrame) => void;
  /** Called once when the stream ends, including when the connection drops. */
  onClosed: (reason: string) => void;
};

export type TerminalHandle = {
  input: (text: string) => void;
  close: () => void;
};

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const CALL_TIMEOUT_MS = 15_000;
/** Give up on an attempt if no address has answered by then (dead LAN IPs can hang for a minute). */
const CONNECT_TIMEOUT_MS = 8_000;

export class HostCallError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type HeaderWebSocket = new (url: string, protocols: string[] | undefined, options: { headers: Record<string, string> }) => WebSocket;

/** React Native's WebSocket accepts headers as a third argument (browsers' doesn't). */
function openSocket(url: string, token: string): WebSocket {
  const Socket = globalThis.WebSocket as unknown as HeaderWebSocket;
  return new Socket(url, undefined, { headers: { Authorization: `Bearer ${token}` } });
}

/**
 * Connection to a sheperd host (directly or through the relay). Reconnects
 * with backoff and exposes a snapshot for `useSyncExternalStore`.
 */
export class HostClient {
  private ws: WebSocket | null = null;
  private attemptSockets: WebSocket[] = [];
  private attempt = 0;
  private state: HostState = { status: "idle", error: null, host: null, activeUrl: null, agents: [] };
  private listeners = new Set<() => void>();
  private statusListeners = new Set<(change: StatusChange) => void>();
  private terminals = new Map<string, TerminalHandlers>();
  private pending = new Map<string, Pending>();
  private nextId = 0;
  private retryMs = MIN_RETRY_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private readonly settings: ConnectionSettings;

  constructor(settings: ConnectionSettings) {
    this.settings = settings;
  }

  getState = (): HostState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onStatusChange(listener: (change: StatusChange) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.attempt++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    for (const ws of this.attemptSockets) ws.close();
    this.attemptSockets = [];
    this.ws = null;
    this.failPending("disconnected");
    this.setState({ status: "idle", activeUrl: null });
  }

  /** Reconnect now (e.g. when the app returns to the foreground). */
  reconnectNow(): void {
    if (this.stopped || this.state.status === "online" || this.state.status === "connecting") return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryMs = MIN_RETRY_MS;
    this.open();
  }

  call<T = Record<string, unknown>>(
    method: CallMethod,
    params: Record<string, unknown> = {},
    { timeoutMs = CALL_TIMEOUT_MS }: { timeoutMs?: number } = {},
  ): Promise<T> {
    if (!this.ws || this.state.status !== "online") {
      return Promise.reject(new HostCallError("offline", "Not connected to the host"));
    }
    const id = String(++this.nextId);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HostCallError("timeout", `${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send({ type: "call", id, method, params });
    });
  }

  /**
   * Stream a pane's terminal. Without cols/rows it uses the pane's own size;
   * a `control` stream with cols/rows resizes the pane until it is closed.
   */
  openTerminal(
    paneId: string,
    opts: { mode: TerminalMode; cols?: number; rows?: number },
    handlers: TerminalHandlers,
  ): TerminalHandle | null {
    if (!this.ws || this.state.status !== "online") return null;
    const streamId = `t${++this.nextId}`;
    this.terminals.set(streamId, handlers);
    this.send({ type: "terminal.open", streamId, paneId, ...opts });
    return {
      input: (text) => {
        if (this.terminals.has(streamId)) this.send({ type: "terminal.input", streamId, text });
      },
      close: () => {
        if (!this.terminals.delete(streamId)) return;
        this.send({ type: "terminal.close", streamId });
      },
    };
  }

  private send(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg));
  }

  /** Dial every address at once; the first to send `hello` wins, the rest are closed. */
  private open(): void {
    const attempt = ++this.attempt;
    this.setState({ status: "connecting", error: null });

    const sockets: WebSocket[] = [];
    let failed = 0;
    let unauthorized = false;
    let lastError: string | null = null;
    const isCurrent = () => attempt === this.attempt && !this.stopped;

    const timeout = setTimeout(() => {
      if (isCurrent() && !this.ws) for (const ws of sockets) ws.close();
    }, CONNECT_TIMEOUT_MS);

    const attemptFailed = () => {
      clearTimeout(timeout);
      if (unauthorized) {
        this.stopped = true;
        this.setState({ status: "unauthorized", error: "The host rejected this token. Scan the QR code again." });
        return;
      }
      this.setState({ status: "offline", error: lastError ?? "No address answered" });
      this.scheduleRetry();
    };

    for (const url of this.settings.urls) {
      const ws = openSocket(url, this.settings.token);
      sockets.push(ws);

      ws.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (this.ws !== ws) {
          if (!isCurrent() || this.ws || msg.type !== "hello") {
            ws.close();
            return;
          }
          clearTimeout(timeout);
          this.ws = ws;
          for (const other of sockets) if (other !== ws) other.close();
          this.attemptSockets = [ws];
          this.setState({ activeUrl: url });
        }
        this.handle(msg);
      };

      ws.onerror = (event) => {
        const message = (event as unknown as { message?: string }).message ?? "connection error";
        if (/\b401\b/.test(message)) unauthorized = true;
        lastError = message;
      };

      ws.onclose = () => {
        if (this.ws === ws) {
          // The live connection dropped.
          this.ws = null;
          this.failPending("disconnected");
          if (!isCurrent()) return;
          this.setState({ status: "offline", activeUrl: null });
          this.scheduleRetry();
          return;
        }
        if (!isCurrent() || this.ws) return;
        if (++failed === sockets.length) attemptFailed();
      };
    }
    this.attemptSockets = sockets;
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case "hello":
        this.retryMs = MIN_RETRY_MS;
        this.setState({ status: "online", error: null, host: msg.host, agents: msg.agents });
        return;
      case "agents":
        this.setState({ agents: msg.agents });
        return;
      case "agent.status":
        for (const listener of this.statusListeners) listener(msg);
        return;
      case "terminal.frame":
        this.terminals.get(msg.streamId)?.onFrame(msg);
        return;
      case "terminal.closed": {
        const handlers = this.terminals.get(msg.streamId);
        this.terminals.delete(msg.streamId);
        handlers?.onClosed(msg.reason);
        return;
      }
      case "result": {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        pending.resolve(msg.result);
        return;
      }
      case "error": {
        const pending = msg.id ? this.pending.get(msg.id) : undefined;
        if (!pending || !msg.id) return;
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        pending.reject(new HostCallError(msg.error.code, msg.error.message));
        return;
      }
      default:
        return;
    }
  }

  private failPending(code: string): void {
    const terminals = [...this.terminals.values()];
    this.terminals.clear();
    for (const handlers of terminals) handlers.onClosed("disconnected");

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new HostCallError(code, "Connection lost"));
      this.pending.delete(id);
    }
  }

  private setState(patch: Partial<HostState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
