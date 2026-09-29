import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { ServerMessage } from "@sheperd/protocol";
import { AppSession, type SessionDeps } from "./session.ts";

const HEARTBEAT_MS = 30_000;
/** Drop an app that can't keep up rather than buffering terminal frames forever. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Bearer header, or `?token=` for clients (WebViews) that can't set headers. */
export function presentedToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.searchParams.get("token");
}

/** Run an AppSession over any connected WebSocket (LAN or relay-dialed). */
export function attachSession(ws: WebSocket, deps: SessionDeps): AppSession {
  const send = (msg: ServerMessage) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      ws.terminate();
      return;
    }
    ws.send(JSON.stringify(msg));
  };
  const session = new AppSession(send, deps);

  let alive = true;
  ws.on("pong", () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, HEARTBEAT_MS);

  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    void session.handle(data.toString());
  });
  ws.on("close", () => {
    clearInterval(heartbeat);
    session.close();
  });
  ws.on("error", () => ws.terminate());
  return session;
}

export type LocalServer = { port: number; close: () => Promise<void> };

/** Serve the app protocol directly, for LAN / Tailscale use without the relay. */
export function startLocalServer(opts: { port: number; bind: string; token: string; deps: SessionDeps }): Promise<LocalServer> {
  const http = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/connect" || !tokenMatches(presentedToken(req), opts.token)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
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
