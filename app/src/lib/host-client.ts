import type { AgentInfo, ClientMessage, ForwardedMethod, HostInfo, ServerMessage, StatusChange } from "@sheperd/protocol";

export type ConnectionSettings = {
  /** ws://host:7420/connect on the LAN, or the relay's wss://…/hosts/<id>/connect */
  url: string;
  token: string;
};

export type ConnectionStatus = "idle" | "connecting" | "online" | "offline" | "unauthorized";

export type HostState = {
  status: ConnectionStatus;
  error: string | null;
  host: HostInfo | null;
  agents: AgentInfo[];
};

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const CALL_TIMEOUT_MS = 15_000;

export class HostCallError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Connection to a sheperd host (directly or through the relay). Reconnects
 * with backoff and exposes a snapshot for `useSyncExternalStore`.
 */
export class HostClient {
  private ws: WebSocket | null = null;
  private state: HostState = { status: "idle", error: null, host: null, agents: [] };
  private listeners = new Set<() => void>();
  private statusListeners = new Set<(change: StatusChange) => void>();
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
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
    this.failPending("disconnected");
    this.setState({ status: "idle" });
  }

  /** Reconnect now (e.g. when the app returns to the foreground). */
  reconnectNow(): void {
    if (this.stopped || this.state.status === "online" || this.state.status === "connecting") return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryMs = MIN_RETRY_MS;
    this.open();
  }

  call<T = Record<string, unknown>>(method: ForwardedMethod, params: Record<string, unknown> = {}): Promise<T> {
    const ws = this.ws;
    if (!ws || this.state.status !== "online") {
      return Promise.reject(new HostCallError("offline", "Not connected to the host"));
    }
    const id = String(++this.nextId);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HostCallError("timeout", `${method} timed out`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send({ type: "call", id, method, params });
    });
  }

  private send(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private open(): void {
    this.setState({ status: "connecting", error: null });
    // React Native's WebSocket accepts headers as a third argument.
    const RNWebSocket = WebSocket as unknown as new (
      url: string,
      protocols: string[] | undefined,
      options: { headers: Record<string, string> },
    ) => WebSocket;
    const ws = new RNWebSocket(this.settings.url, undefined, {
      headers: { Authorization: `Bearer ${this.settings.token}` },
    });
    this.ws = ws;

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onerror = (event) => {
      const message = (event as unknown as { message?: string }).message ?? "connection error";
      if (/\b401\b/.test(message)) {
        this.stopped = true;
        this.setState({ status: "unauthorized", error: "The host rejected this token." });
      } else {
        this.setState({ error: message });
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.failPending("disconnected");
      if (this.stopped) return;
      this.setState({ status: "offline" });
      const delay = this.retryMs;
      this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
      this.retryTimer = setTimeout(() => this.open(), delay);
    };
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
