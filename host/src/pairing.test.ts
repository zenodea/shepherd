import { describe, expect, it } from "vitest";
import type { networkInterfaces } from "node:os";
import { parsePairingLink, encodePairingLink } from "@sheperd/protocol";
import type { HostConfig } from "./config.ts";
import { hostAddresses, pairingInfo, renderQr } from "./pairing.ts";

const config: HostConfig = {
  hostId: "abc123",
  token: "secret-token",
  name: "laptop",
  configPath: "/tmp/host.json",
  port: 7420,
  bind: "0.0.0.0",
  herdrBin: "herdr",
  socketPath: "/tmp/herdr.sock",
};

const iface = (address: string, internal = false) => ({
  address,
  internal,
  family: "IPv4" as const,
  netmask: "255.255.255.0",
  mac: "00:00:00:00:00:00",
  cidr: null,
});

const interfaces = {
  lo0: [iface("127.0.0.1", true)],
  utun4: [iface("100.95.112.5")],
  en0: [iface("192.168.1.20")],
} as unknown as ReturnType<typeof networkInterfaces>;

describe("hostAddresses", () => {
  it("lists LAN before Tailscale, then the relay, skipping loopback", () => {
    expect(hostAddresses({ ...config, relayUrl: "https://relay.dev" }, 7420, interfaces)).toEqual([
      { label: "LAN", url: "ws://192.168.1.20:7420/connect" },
      { label: "Tailscale", url: "ws://100.95.112.5:7420/connect" },
      { label: "Relay", url: "wss://relay.dev/hosts/abc123/connect" },
    ]);
  });

  it("only offers the relay when bound to localhost", () => {
    expect(hostAddresses({ ...config, bind: "127.0.0.1" }, 7420, interfaces)).toEqual([]);
    expect(hostAddresses({ ...config, bind: "127.0.0.1", relayUrl: "wss://r.dev" }, 7420, interfaces)).toEqual([
      { label: "Relay", url: "wss://r.dev/hosts/abc123/connect" },
    ]);
  });
});

describe("pairing QR", () => {
  it("encodes a link the app can parse", async () => {
    const info = pairingInfo(config, 7420, interfaces);
    expect(parsePairingLink(encodePairingLink(info))).toEqual(info);
    const qr = await renderQr(encodePairingLink(info));
    expect(qr.split("\n").length).toBeGreaterThan(10);
  });
});
