import { describe, expect, it } from "vitest";
import { accepts, listenAddress, routesOf } from "./routes.ts";

const interfaces = {
  en0: [{ address: "192.168.1.20", family: "IPv4", internal: false, netmask: "", mac: "", cidr: null }],
  utun4: [{ address: "100.101.102.103", family: "IPv4", internal: false, netmask: "", mac: "", cidr: null }],
} as unknown as ReturnType<typeof import("node:os").networkInterfaces>;

describe("connection routes", () => {
  it("listens everywhere with LAN on, only on Tailscale without it, and nowhere with neither", () => {
    expect(listenAddress("0.0.0.0", { lan: true, tailscale: false, relay: true }, interfaces)).toBe("0.0.0.0");
    expect(listenAddress("0.0.0.0", { lan: false, tailscale: true, relay: true }, interfaces)).toBe("100.101.102.103");
    expect(listenAddress("0.0.0.0", { lan: false, tailscale: false, relay: true }, interfaces)).toBeNull();
  });

  it("drops connections that arrive on a route that's off", () => {
    const lanOnly = { lan: true, tailscale: false, relay: true };
    expect(accepts(lanOnly, "192.168.1.20")).toBe(true);
    expect(accepts(lanOnly, "::ffff:100.101.102.103")).toBe(false);
    expect(accepts({ lan: false, tailscale: true, relay: false }, "100.101.102.103")).toBe(true);
    expect(accepts(lanOnly, "127.0.0.1")).toBe(true);
  });

  it("has every route on unless turned off", () => {
    expect(routesOf({ hostId: "h", name: "n" })).toEqual({ lan: true, tailscale: true, relay: true });
    expect(routesOf({ hostId: "h", name: "n", connections: { lan: false } })).toEqual({ lan: false, tailscale: true, relay: true });
  });
});
