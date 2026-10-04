import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import {
  CLOSE_CODES,
  E2E_VERSION,
  WIRE_PROTOCOL_VERSION,
  fromHex,
  generateKeyPair,
  openJson,
  parseAppHandshake,
  respondHandshake,
  sealJson,
  toHex,
  type HostHello,
  type ServerMessage,
  type SessionCiphers,
} from "@shepherd/protocol";
import { AppSession, type SessionDeps } from "./session.ts";

const HEARTBEAT_MS = 30_000;
/** Drop an app that can't keep up rather than buffering terminal frames forever. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * Run an AppSession over any connected WebSocket (LAN or relay-dialed).
 *
 * The host speaks first with its keys (`ready`), the app answers with its
 * ephemeral key (`handshake`), and from then on every frame in both directions
 * is encrypted (see @shepherd/protocol secure.ts). The session, including
 * authentication, only exists inside that channel.
 */
export function attachSession(ws: WebSocket, deps: SessionDeps, via: "direct" | "relay" = "direct"): void {
  const ephemeral = generateKeyPair();
  let ciphers: SessionCiphers | null = null;
  let session: AppSession | null = null;

  const closeWith = (code: number, reason: string) => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(code, reason);
  };
  const handshakeTimer = setTimeout(() => closeWith(CLOSE_CODES.insecure, "handshake timed out"), HANDSHAKE_TIMEOUT_MS);

  const hello: HostHello = {
    type: "ready",
    protocol: WIRE_PROTOCOL_VERSION,
    e2e: { version: E2E_VERSION, hostKey: toHex(deps.hostKey.publicKey), ephemeral: toHex(ephemeral.publicKey) },
  };
  ws.send(JSON.stringify(hello));

  const send = (msg: ServerMessage) => {
    if (ws.readyState !== WebSocket.OPEN || !ciphers) return;
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      ws.terminate();
      return;
    }
    ws.send(sealJson(ciphers.send, msg), { binary: true });
  };

  let alive = true;
  ws.on("pong", () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, HEARTBEAT_MS);

  ws.on("message", (data, isBinary) => {
    const bytes = data instanceof Buffer ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)]);
    if (!ciphers) {
      const handshake = isBinary ? null : parseAppHandshake(bytes.toString());
      if (!handshake) return closeWith(CLOSE_CODES.insecure, "expected handshake");
      try {
        ciphers = respondHandshake(deps.hostKey, ephemeral, fromHex(handshake.ephemeral));
      } catch {
        return closeWith(CLOSE_CODES.insecure, "bad handshake");
      }
      clearTimeout(handshakeTimer);
      session = new AppSession({ send, close: closeWith, via }, deps);
      return;
    }
    if (!isBinary) return closeWith(CLOSE_CODES.insecure, "unencrypted frame");
    let text: string;
    try {
      text = openJson(ciphers.receive, new Uint8Array(bytes));
    } catch {
      return closeWith(CLOSE_CODES.insecure, "decryption failed");
    }
    session?.handle(text).catch((err: unknown) => console.error(`[session] ${err instanceof Error ? err.stack : String(err)}`));
  });
  ws.on("close", () => {
    clearTimeout(handshakeTimer);
    clearInterval(heartbeat);
    session?.close();
  });
  ws.on("error", () => ws.terminate());
}

export type LocalServer = { port: number; close: () => Promise<void> };

/**
 * Serve the app protocol directly, for LAN / Tailscale use without the relay.
 * Apps authenticate with their first message (see AppSession), the same way
 * they do through the relay.
 */
export function startLocalServer(opts: { port: number; bind: string; deps: SessionDeps; accepts?: (localAddress: string | undefined) => boolean }): Promise<LocalServer> {
  const http = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  if (opts.accepts) http.on("connection", (socket) => opts.accepts!(socket.localAddress) || socket.destroy());

  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/connect") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attachSession(ws, opts.deps));
  });

  return new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(opts.port, opts.bind, () => {
      resolve({
        port: (http.address() as AddressInfo).port,
        close: () =>
          new Promise<void>((done) => {
            for (const client of wss.clients) client.terminate();
            wss.close();
            http.close(() => done());
          }),
      });
    });
  });
}
