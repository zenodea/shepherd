import {
  CLOSE_CODES,
  fromHex,
  initiateHandshake,
  openJson,
  parseHostHello,
  relayCredential,
  sealJson,
  toHex,
  WIRE_PROTOCOL_VERSION,
  type AgentInfo,
  type CallMethod,
  type ClientMessage,
  type DeviceInfo,
  type HostInfo,
  type ServerMessage,
  type SessionCiphers,
  type StatusChange,
  type TerminalMode,
  type TerminalRender,
} from "@shepherd/protocol";

export type ConnectionSettings = {
  /** Display name from pairing; the host's own name wins once connected. */
  name?: string;
  /**
   * Every address the host may be reachable on (LAN, Tailscale, relay). All
   * are tried at once and the first to answer is used.
   */
  urls: string[];
  /** This device's token, or a one-time pairing code until the host swaps it for one. */
  token: string;
  /**
   * The host's public key (hex), from the pairing QR code. Connections to
   * anything presenting a different key are refused. Phones paired before
   * encryption pin the first key they see.
   */
  hostKey?: string;
  /** From a typed pairing code: the start of the host's key, checked until the full key is pinned. */
  hostKeyPrefix?: string;
};

/** Keep at most this many addresses (the host's current ones first). */
const MAX_URLS = 8;

export type ConnectionStatus = "idle" | "connecting" | "online" | "offline" | "unauthorized";

export type HostState = {
  status: ConnectionStatus;
  error: string | null;
  host: HostInfo | null;
  /** The address currently in use. */
  activeUrl: string | null;
  /** Every address being tried. */
  urls: string[];
  /** How the host knows this phone. */
  device: DeviceInfo | null;
  agents: AgentInfo[];
};

export type TerminalFrame = Extract<ServerMessage, { type: "terminal.frame" }>;
export type TerminalLines = Extract<ServerMessage, { type: "terminal.lines" }>;

export type TerminalHandlers = {
  onFrame?: (frame: TerminalFrame) => void;
  /** Streams opened with render "lines". */
  onLines?: (lines: TerminalLines) => void;
  /** Called once when the stream ends, including when the connection drops. */
  onClosed: (reason: string) => void;
};

export type TerminalHandle = {
  input: (text: string) => void;
  /** Scroll the pane's view (control streams only). */
  scroll: (direction: "up" | "down", lines: number) => void;
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

const AUTH_ERRORS: Record<number, string> = {
  [CLOSE_CODES.unauthorized]: "This phone isn't paired with the host. Scan a pairing QR code.",
  [CLOSE_CODES.pairingExpired]: "That pairing QR code has expired or was already used. Open the Shepherd window on your computer and choose Pair for a new one.",
  [CLOSE_CODES.revoked]: "This phone was removed on the host. Scan a new pairing QR code.",
};

const HOST_KEY_CHANGED =
  "The host's identity key doesn't match the one from pairing, so Shepherd refused to connect. If you reinstalled the host, scan a new pairing QR code.";

const NOT_YOUR_HOST = "Something other than your computer answered. Check the address and code.";

/** Why the host and this app can't talk, or null when they speak the same protocol. */
function versionError(hostProtocol: number): string | null {
  if (hostProtocol === WIRE_PROTOCOL_VERSION) return null;
  return hostProtocol > WIRE_PROTOCOL_VERSION
    ? "Your computer runs a newer Shepherd. Update the Shepherd app on your phone."
    : "Your computer runs an older Shepherd. Update Shepherd on your computer.";
}

/**
 * The relay gates connections on `relayCredential(token)` (a hash); the real
 * token only travels inside the encrypted channel. Direct connections ignore it.
 */
function openSocket(url: string, token: string): WebSocket {
  const Socket = globalThis.WebSocket as unknown as HeaderWebSocket;
  const ws = new Socket(url, undefined, { headers: { Authorization: `Bearer ${relayCredential(token)}` } });
  ws.binaryType = "arraybuffer";
  return ws;
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

/** What screens use; implemented by HostClient and by the demo host. */
export type HostConnection = Pick<
  HostClient,
  "getState" | "subscribe" | "onStatusChange" | "start" | "stop" | "reconnectNow" | "checkConnection" | "call" | "openTerminal"
>;

/**
 * Connection to a shepherd host (directly or through the relay). Reconnects
 * with backoff and exposes a snapshot for `useSyncExternalStore`.
 */
export class HostClient {
  private ws: WebSocket | null = null;
  private ciphers: SessionCiphers | null = null;
  private attemptSockets: WebSocket[] = [];
  private attempt = 0;
  private state: HostState;
  private listeners = new Set<() => void>();
  private statusListeners = new Set<(change: StatusChange) => void>();
  private terminals = new Map<string, TerminalHandlers>();
  private pending = new Map<string, Pending>();
  private nextId = 0;
  private retryMs = MIN_RETRY_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the host last sent anything, and when the current connection attempt began. */
  private lastHeard = 0;
  private openedAt = 0;
  private stopped = true;
  private settings: ConnectionSettings;
  private savedHostKey: string | undefined;
  private readonly deviceName: string;
  private readonly onSettingsChange: (settings: ConnectionSettings) => void;

  constructor(
    settings: ConnectionSettings,
    opts: { deviceName?: string; onSettingsChange?: (settings: ConnectionSettings) => void } = {},
  ) {
    this.settings = settings;
    this.savedHostKey = settings.hostKey;
    this.deviceName = opts.deviceName ?? "Phone";
    this.onSettingsChange = opts.onSettingsChange ?? (() => {});
    this.state = { status: "idle", error: null, host: null, activeUrl: null, urls: settings.urls, device: null, agents: [] };
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

  /**
   * For the background service, which ticks even while Android pauses JS
   * timers: ping the host, and start over when the connection has gone quiet
   * (a dropped network can leave a socket that never reports closing).
   */
  checkConnection(staleMs: number): void {
    if (this.stopped) return;
    const now = Date.now();
    if (this.state.status === "online" && this.ws) {
      if (now - this.lastHeard <= staleMs) {
        this.send({ type: "ping", t: now });
        return;
      }
      const dead = this.ws;
      this.ws = null;
      this.ciphers = null;
      this.failPending("disconnected");
      dead.close();
      this.retryMs = MIN_RETRY_MS;
      this.open();
      return;
    }
    if (this.state.status === "connecting" && now - this.openedAt <= staleMs) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryMs = MIN_RETRY_MS;
    this.open();
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
    opts: { mode: TerminalMode; cols?: number; rows?: number; render?: TerminalRender },
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
      scroll: (direction, lines) => {
        if (this.terminals.has(streamId) && lines > 0) this.send({ type: "terminal.scroll", streamId, direction, lines: Math.min(lines, 1000) });
      },
      close: () => {
        if (!this.terminals.delete(streamId)) return;
        this.send({ type: "terminal.close", streamId });
      },
    };
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ciphers) this.ws.send(sealJson(this.ciphers.send, msg));
  }

  /** Save a newly issued device token and the host's current addresses. */
  private adopt(hello: Extract<ServerMessage, { type: "hello" }>): void {
    const token = hello.credentials?.token ?? this.settings.token;
    const urls = [...new Set([...(hello.host.addresses ?? []), ...this.settings.urls])].slice(0, MAX_URLS);
    const changed =
      token !== this.settings.token || urls.join() !== this.settings.urls.join() || this.settings.hostKey !== this.savedHostKey;
    this.settings = { ...this.settings, name: hello.host.name, token, urls };
    this.savedHostKey = this.settings.hostKey;
    if (changed) this.onSettingsChange(this.settings);
  }

  /** Dial every address at once; the first to send `hello` wins, the rest are closed. */
  private open(): void {
    for (const ws of this.attemptSockets) if (ws !== this.ws) ws.close();
    const attempt = ++this.attempt;
    this.openedAt = Date.now();
    this.setState({ status: "connecting", error: null });

    const sockets: WebSocket[] = [];
    let failed = 0;
    let unauthorized = false;
    let authError: string | null = null;
    let lastError: string | null = null;
    const isCurrent = () => attempt === this.attempt && !this.stopped;

    const timeout = setTimeout(() => {
      if (isCurrent() && !this.ws) for (const ws of sockets) ws.close();
    }, CONNECT_TIMEOUT_MS);

    const attemptFailed = () => {
      clearTimeout(timeout);
      if (unauthorized) {
        this.stopped = true;
        this.setState({ status: "unauthorized", error: authError ?? AUTH_ERRORS[CLOSE_CODES.unauthorized]! });
        return;
      }
      this.setState({ status: "offline", error: lastError ?? "No address answered" });
      this.scheduleRetry();
    };

    for (const url of this.settings.urls) {
      const ws = openSocket(url, this.settings.token);
      sockets.push(ws);

      let ciphers: SessionCiphers | null = null;
      let offeredHostKey: string | null = null;

      ws.onmessage = (event) => {
        // 1. The host's plaintext `ready` with its keys; answer with our handshake.
        if (!ciphers) {
          const ready = typeof event.data === "string" ? parseHostHello(event.data) : null;
          if (!ready) return ws.close();
          const { hostKey, hostKeyPrefix } = this.settings;
          const refusal =
            hostKey && ready.e2e.hostKey !== hostKey
              ? HOST_KEY_CHANGED
              : !hostKey && hostKeyPrefix && !ready.e2e.hostKey.startsWith(hostKeyPrefix)
                ? NOT_YOUR_HOST
                : versionError(ready.protocol);
          if (refusal) {
            unauthorized = true;
            authError = refusal;
            return ws.close();
          }
          try {
            const handshake = initiateHandshake(fromHex(ready.e2e.hostKey), fromHex(ready.e2e.ephemeral));
            ciphers = handshake.ciphers;
            offeredHostKey = ready.e2e.hostKey;
            ws.send(JSON.stringify({ type: "handshake", ephemeral: toHex(handshake.ephemeral) }));
            ws.send(sealJson(ciphers.send, { type: "auth", token: this.settings.token, device: { name: this.deviceName }, protocol: WIRE_PROTOCOL_VERSION }));
          } catch {
            ws.close();
          }
          return;
        }

        // 2. Everything else is encrypted.
        const bytes = toBytes(event.data);
        if (!bytes) return ws.close();
        let msg: ServerMessage;
        try {
          msg = JSON.parse(openJson(ciphers.receive, bytes));
        } catch {
          return ws.close();
        }
        if (this.ws !== ws) {
          if (!isCurrent() || this.ws) {
            ws.close();
            return;
          }
          if (msg.type === "auth.error") {
            // The host closes the connection next; don't retry.
            unauthorized = true;
            authError = msg.message;
            return;
          }
          if (msg.type !== "hello") return;
          clearTimeout(timeout);
          this.ws = ws;
          this.ciphers = ciphers;
          if (!this.settings.hostKey && offeredHostKey) this.settings = { ...this.settings, hostKey: offeredHostKey, hostKeyPrefix: undefined };
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

      ws.onclose = (event) => {
        if (event.code in AUTH_ERRORS) {
          unauthorized = true;
          authError ??= AUTH_ERRORS[event.code]!;
        }
        if (this.ws === ws) {
          // The live connection dropped.
          this.ws = null;
          this.ciphers = null;
          this.failPending("disconnected");
          if (!isCurrent()) return;
          if (event.code in AUTH_ERRORS) {
            // Revoked while connected.
            this.stopped = true;
            this.setState({ status: "unauthorized", activeUrl: null, error: authError });
            return;
          }
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
    this.lastHeard = Date.now();
    switch (msg.type) {
      case "hello":
        this.retryMs = MIN_RETRY_MS;
        this.adopt(msg);
        this.setState({
          status: "online",
          error: null,
          host: msg.host,
          device: msg.device,
          urls: this.settings.urls,
          agents: msg.agents,
        });
        return;
      case "agents":
        this.setState({ agents: msg.agents });
        return;
      case "agent.status":
        for (const listener of this.statusListeners) listener(msg);
        return;
      case "terminal.frame":
        this.terminals.get(msg.streamId)?.onFrame?.(msg);
        return;
      case "terminal.lines":
        this.terminals.get(msg.streamId)?.onLines?.(msg);
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
