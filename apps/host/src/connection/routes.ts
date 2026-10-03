import { networkInterfaces } from "node:os";
import type { StoredConfig } from "../system/config.ts";

export const ROUTES = ["lan", "tailscale", "relay"] as const;
export type Route = (typeof ROUTES)[number];
export type Routes = Record<Route, boolean>;

export const ROUTE_LABELS: Record<Route, string> = { lan: "LAN", tailscale: "Tailscale", relay: "Relay" };

type Interfaces = ReturnType<typeof networkInterfaces>;

export function routesOf(config: StoredConfig): Routes {
  return { lan: config.connections?.lan !== false, tailscale: config.connections?.tailscale !== false, relay: config.connections?.relay !== false };
}

/** Tailscale hands out addresses from the CGNAT range 100.64.0.0/10. */
export function isTailscale(ip: string): boolean {
  const [a, b] = ip.replace(/^::ffff:/, "").split(".").map(Number);
  return a === 100 && b! >= 64 && b! <= 127;
}

export function tailscaleAddress(interfaces: Interfaces = networkInterfaces()): string | null {
  for (const i of Object.values(interfaces).flat()) if (i && i.family === "IPv4" && !i.internal && isTailscale(i.address)) return i.address;
  return null;
}

/**
 * Where the direct server listens: everywhere when LAN is on (connections on a
 * route that's off are dropped by `accepts`), only the Tailscale address when
 * it's the only direct route, or nowhere.
 */
export function listenAddress(bind: string, routes: Routes, interfaces?: Interfaces): string | null {
  if (routes.lan) return bind;
  return routes.tailscale ? tailscaleAddress(interfaces) : null;
}

/** Whether a connection that arrived on this local address uses a route that's on. */
export function accepts(routes: Routes, localAddress: string | undefined): boolean {
  if (!localAddress) return false;
  const ip = localAddress.replace(/^::ffff:/, "");
  if (ip === "127.0.0.1" || ip === "::1") return true;
  return isTailscale(ip) ? routes.tailscale : routes.lan;
}

const relaySetUp = (config: StoredConfig) => Boolean(config.relayUrl && config.relayHostToken);

/** The routes, if they leave phones a way in; throws otherwise. `asked`: the ones being turned on. */
export function checkRoutes(config: StoredConfig, routes: Routes, asked: readonly Route[] = []): Routes {
  if (asked.includes("relay") && routes.relay && !relaySetUp(config)) throw new Error("Set up a relay first: npm run host -- relay <url> <host-token>");
  if (!routes.lan && !routes.tailscale && !(routes.relay && relaySetUp(config))) throw new Error("Leave at least one way in on, or phones can't reach Shepherd.");
  return routes;
}

export const withRoute = (config: StoredConfig, route: Route, on: boolean): Routes =>
  checkRoutes(config, { ...routesOf(config), [route]: on }, on ? [route] : []);
