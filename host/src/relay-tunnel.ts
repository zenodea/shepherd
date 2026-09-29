import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { TUNNEL_PING, TUNNEL_PONG, parseRelayToHost, relayPaths, type HostToRelay } from "@sheperd/protocol";
import { attachSession } from "./server.ts";
import type { SessionDeps } from "./session.ts";

const HEARTBEAT_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;

export type TunnelOptions = {
  relayUrl: string;
  hostId: string;
  /** Shared secret the relay expects from hosts (its HOST_TOKEN). */
  hostToken: string;
  /** The app token; only its SHA-256 is sent to the relay. */
  clientToken: string;
  deps: SessionDeps;
};

export type TunnelState = "connecting" | "online" | "offline";

type TunnelEvents = {
  state: [TunnelState, string?];
};

/** Base URL for sockets: accepts https://, http://, wss:// or ws://. */
export function relayBase(relayUrl: string): string {
  const url = new URL(relayUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol !== "wss:" && url.protocol !== "ws:") throw new Error(`unsupported relay URL: ${relayUrl}`);
  return url.origin;
}

export function appRelayUrl(relayUrl: string, hostId: string): string {
  return relayBase(relayUrl) + relayPaths.connect(hostId);
}

/**
 * Keeps an outbound control socket open to the relay and, for every app that
 * connects there, dials a fresh data socket and runs an AppSession on it.
 */
export class RelayTunnel extends EventEmitter<TunnelEvents> {
  private control: WebSocket | null = null;
  private dataSockets = new Set<WebSocket>();
  private heartbeat: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryMs = MIN_RETRY_MS;
  private lastPong = 0;
  private stopped = true;
  private readonly opts: TunnelOptions;
  private readonly base: string;

  constructor(opts: TunnelOptions) {
    super();
    this.opts = opts;
    this.base = relayBase(opts.relayUrl);
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.stopHeartbeat();
    this.control?.close(1000, "host shutting down");
    this.control = null;
    for (const ws of this.dataSockets) ws.close(1001, "host shutting down");
    this.dataSockets.clear();
  }

  private headers() {
    return { authorization: `Bearer ${this.opts.hostToken}` };
  }

  private connect(): void {
    this.emit("state", "connecting");
    const ws = new WebSocket(this.base + relayPaths.control(this.opts.hostId), { headers: this.headers() });
    this.control = ws;

    ws.on("open", () => {
      const register: HostToRelay = {
        type: "register",
        clientTokenHash: createHash("sha256").update(this.opts.clientToken).digest("hex"),
      };
      ws.send(JSON.stringify(register));
      this.startHeartbeat(ws);
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString();
      if (text === TUNNEL_PONG) {
        this.lastPong = Date.now();
        return;
      }
      const msg = parseRelayToHost(text);
      if (msg?.type === "registered") {
        this.retryMs = MIN_RETRY_MS;
        this.emit("state", "online");
      } else if (msg?.type === "dial") {
        this.dial(msg.ticket);
      }
    });

    ws.on("unexpected-response", (_req, res) => {
      const hint = res.statusCode === 401 ? " (check the relay host token)" : "";
      this.emit("state", "offline", `relay refused control connection: HTTP ${res.statusCode}${hint}`);
      ws.terminate();
    });
    ws.on("error", (err) => this.emit("state", "offline", err.message));
    ws.on("close", () => {
      if (this.control !== ws) return;
      this.control = null;
      this.stopHeartbeat();
      this.scheduleReconnect();
    });
  }

  private dial(ticket: string): void {
    const ws = new WebSocket(this.base + relayPaths.dial(this.opts.hostId, ticket), {
      headers: this.headers(),
      maxPayload: 1024 * 1024,
    });
    this.dataSockets.add(ws);
    ws.on("open", () => attachSession(ws, this.opts.deps));
    ws.on("close", () => this.dataSockets.delete(ws));
    ws.on("error", () => ws.terminate());
  }

  private startHeartbeat(ws: WebSocket): void {
    this.lastPong = Date.now();
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastPong > HEARTBEAT_TIMEOUT_MS) {
        ws.terminate();
        return;
      }
      ws.send(TUNNEL_PING);
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.emit("state", "offline");
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }
}
