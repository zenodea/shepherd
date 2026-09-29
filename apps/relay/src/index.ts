import { HOST_ID_PATTERN } from "@shepherd/protocol";
import { bearerToken, secretsEqual } from "./auth.ts";

export { HostRoom } from "./host-room.ts";

const ROUTE = /^\/hosts\/([^/]+)\/(control|dial|connect)$/;

/**
 * Entry point. Checks the host secret for host-side routes and forwards every
 * WebSocket upgrade to the one HostRoom that owns that host id.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return new Response("ok\n");

    const match = ROUTE.exec(url.pathname);
    if (!match) return new Response("not found\n", { status: 404 });
    const [, rawHostId, kind] = match;
    const hostId = decodeURIComponent(rawHostId!);
    if (!HOST_ID_PATTERN.test(hostId)) return new Response("bad host id\n", { status: 400 });
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket upgrade\n", { status: 426 });
    }

    if (kind === "control" || kind === "dial") {
      if (!env.HOST_TOKEN) return new Response("relay has no HOST_TOKEN configured\n", { status: 500 });
      if (!(await secretsEqual(bearerToken(request), env.HOST_TOKEN))) {
        return new Response("unauthorized\n", { status: 401 });
      }
    }
    // App connections are checked inside the room against the hash its host registered.

    const room = env.HOST_ROOM.get(env.HOST_ROOM.idFromName(hostId));
    const forwarded = new Request(request);
    forwarded.headers.set("x-shepherd-kind", kind!);
    return room.fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;
