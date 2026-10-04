import { DurableObject } from "cloudflare:workers";
import { TUNNEL_PING, TUNNEL_PONG, parseHostToRelay, type RelayToHost } from "@shepherd/protocol";
import { bearerToken, hashesEqual, sha256Hex } from "./auth.ts";

type Attachment =
  | { role: "control" }
  | { role: "client"; ticket: string; openedAt: number; paired: boolean }
  | { role: "data"; ticket: string };

const DIAL_TIMEOUT_MS = 10_000;
const MAX_PENDING_DIALS = 16;
const CLIENT_TOKEN_HASHES_KEY = "clientTokenHashes";

/**
 * One per host. Holds the host's control socket, admits app connections, asks
 * the host to dial back, and splices each app socket to its dialed data
 * socket. Uses the hibernation API, so an idle room costs nothing and the
 * control heartbeat is answered without waking it.
 */
export class HostRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(TUNNEL_PING, TUNNEL_PONG));
  }

  override async fetch(request: Request): Promise<Response> {
    switch (request.headers.get("x-shepherd-kind")) {
      case "control":
        return this.acceptControl();
      case "dial":
        return this.acceptDial(new URL(request.url).searchParams.get("ticket"));
      case "connect":
        return this.acceptClient(request);
      default:
        return new Response("not found\n", { status: 404 });
    }
  }

  private acceptControl(): Response {
    // A reconnecting host replaces its previous control socket.
    for (const old of this.ctx.getWebSockets("control")) safeClose(old, 4000, "replaced by a new host connection");
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, ["control"]);
    server.serializeAttachment({ role: "control" } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async acceptClient(request: Request): Promise<Response> {
    // Gate on the hashes the host registered (they outlive its connection), so
    // only an admitted app learns whether the host is online. The host then
    // checks the token again itself. A host that never registered is offline to everyone.
    const allowed = await this.ctx.storage.get<string[]>(CLIENT_TOKEN_HASHES_KEY);
    if (!allowed) return new Response("host offline\n", { status: 503 });
    const presented = bearerToken(request);
    const hash = presented ? await sha256Hex(presented) : null;
    let admitted = false;
    for (const candidate of allowed) if (hash && hashesEqual(hash, candidate)) admitted = true;
    if (!admitted) return new Response("unauthorized\n", { status: 401 });

    const control = this.ctx.getWebSockets("control")[0];
    if (!control) return new Response("host offline\n", { status: 503 });

    const pending = this.ctx.getWebSockets("client").filter((ws) => {
      const att = attachment(ws);
      return att?.role === "client" && !att.paired;
    });
    if (pending.length >= MAX_PENDING_DIALS) return new Response("too many pending connections\n", { status: 429 });

    const ticket = crypto.randomUUID();
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, ["client", `t:${ticket}`]);
    server.serializeAttachment({ role: "client", ticket, openedAt: Date.now(), paired: false } satisfies Attachment);

    control.send(JSON.stringify({ type: "dial", ticket } satisfies RelayToHost));
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + DIAL_TIMEOUT_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptDial(ticket: string | null): Response {
    if (!ticket) return new Response("missing ticket\n", { status: 400 });
    const appSocket = this.ctx.getWebSockets(`t:${ticket}`).find((ws) => {
      const att = attachment(ws);
      return att?.role === "client" && !att.paired;
    });
    if (!appSocket) return new Response("unknown or expired ticket\n", { status: 404 });

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, ["data", `t:${ticket}`]);
    server.serializeAttachment({ role: "data", ticket } satisfies Attachment);
    appSocket.serializeAttachment({ ...(attachment(appSocket) as Attachment & { role: "client" }), paired: true });
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = attachment(ws);
    if (!att) return;

    if (att.role === "control") {
      if (typeof message !== "string") return;
      const msg = parseHostToRelay(message);
      if (msg?.type === "register") {
        await this.ctx.storage.put(CLIENT_TOKEN_HASHES_KEY, msg.clientTokenHashes);
        ws.send(JSON.stringify({ type: "registered" } satisfies RelayToHost));
      }
      return;
    }

    // App traffic is spliced verbatim. Anything an app sends before its host
    // has dialed is dropped; apps wait for the host's `hello` before talking.
    this.peer(ws, att)?.send(message);
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const att = attachment(ws);
    if (att && att.role !== "control") {
      const peer = this.peer(ws, att);
      if (peer) safeClose(peer, code, reason);
    }
    safeClose(ws, code, reason);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011, "socket error");
  }

  /** Close app sockets whose host never dialed back. */
  override async alarm(): Promise<void> {
    const now = Date.now();
    let waiting = false;
    for (const ws of this.ctx.getWebSockets("client")) {
      const att = attachment(ws);
      if (att?.role !== "client" || att.paired) continue;
      if (now - att.openedAt >= DIAL_TIMEOUT_MS) safeClose(ws, 1013, "host did not answer");
      else waiting = true;
    }
    if (waiting) await this.ctx.storage.setAlarm(now + DIAL_TIMEOUT_MS);
  }

  private peer(ws: WebSocket, att: Exclude<Attachment, { role: "control" }>): WebSocket | undefined {
    const peerRole = att.role === "client" ? "data" : "client";
    return this.ctx.getWebSockets(`t:${att.ticket}`).find((other) => other !== ws && attachment(other)?.role === peerRole);
  }
}

function attachment(ws: WebSocket): Attachment | null {
  return (ws.deserializeAttachment() as Attachment | null) ?? null;
}

/** Close codes 1005/1006/1015 are reserved and can't be sent on the wire. */
function safeClose(ws: WebSocket, code: number, reason: string): void {
  const sendable = code === 1000 || (code >= 1001 && code <= 1014 && ![1005, 1006].includes(code)) || (code >= 3000 && code <= 4999);
  try {
    ws.close(sendable ? code : 1000, reason.slice(0, 120));
  } catch {
    // already closed
  }
}
