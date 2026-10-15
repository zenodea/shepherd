import { describe, expect, it } from "vitest";
import { firewallBlocks, zoneAllows, type FirewallCmd } from "./firewall.ts";

const zone = (target: string, ports = "") => `public (default, active)\n  target: ${target}\n  services: dhcpv6-client ssh\n  ports: ${ports}\n`;
const iface = (address: string) => [{ address, family: "IPv4" as const, internal: false, netmask: "", mac: "", cidr: null }];
const interfaces = { wlan0: iface("10.0.0.5"), tailscale0: iface("100.71.137.106") };
const addresses = [
  { label: "LAN" as const, url: "ws://10.0.0.5:7420/connect" },
  { label: "Tailscale" as const, url: "ws://100.71.137.106:7420/connect" },
  { label: "Relay" as const, url: "wss://relay.example/app/abc" },
];

/** firewalld with wlan0 in public, tailscale0 in no zone, and the given zones. */
const firewalld =
  (zones: Record<string, string>): FirewallCmd =>
  async ([arg = "", second]) => {
    if (arg === "--get-default-zone") return "public";
    if (arg === "--get-zone-of-interface=wlan0") return "public";
    if (arg.startsWith("--get-zone-of-interface=")) return null;
    if (second === "--list-all") return zones[arg.slice("--zone=".length)] ?? null;
    return null;
  };

describe("zoneAllows", () => {
  it("accepts a zone that accepts everything, or lists the port or a range around it", () => {
    expect(zoneAllows(zone("ACCEPT"), 7420)).toBe(true);
    expect(zoneAllows(zone("default", "22/tcp 7420/tcp"), 7420)).toBe(true);
    expect(zoneAllows(zone("default", "7000-8000/tcp"), 7420)).toBe(true);
    expect(zoneAllows(zone("default", "7420/udp 7421/tcp"), 7420)).toBe(false);
    expect(zoneAllows(zone("default"), 7420)).toBe(false);
  });
});

describe("firewallBlocks", () => {
  it("names each interface the default zone would block, with the fix", async () => {
    const blocks = await firewallBlocks(addresses, 7420, firewalld({ public: zone("default") }), interfaces, "linux");
    expect(blocks.map((b) => [b.label, b.iface, b.zone])).toEqual([
      ["LAN", "wlan0", "public"],
      ["Tailscale", "tailscale0", "public"],
    ]);
    expect(blocks[0]?.fix).toBe("sudo firewall-cmd --permanent --zone=public --add-port=7420/tcp && sudo firewall-cmd --reload");
  });

  it("says nothing when the port is open, firewalld isn't running, or it's not Linux", async () => {
    expect(await firewallBlocks(addresses, 7420, firewalld({ public: zone("default", "7420/tcp") }), interfaces, "linux")).toEqual([]);
    expect(await firewallBlocks(addresses, 7420, async () => null, interfaces, "linux")).toEqual([]);
    expect(await firewallBlocks(addresses, 7420, firewalld({ public: zone("default") }), interfaces, "darwin")).toEqual([]);
  });
});
