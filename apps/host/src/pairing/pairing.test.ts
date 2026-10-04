import { describe, expect, it } from "vitest";
import type { networkInterfaces } from "node:os";
import { parseManualCode, parsePairingLink, encodePairingLink } from "@shepherd/protocol";
import type { HostConfig } from "../system/config.ts";
import { hostAddresses, manualCode, pairingInfo, renderQr } from "./pairing.ts";

const config: HostConfig = {
  hostId: "abc123",
  name: "laptop",
  hostKey: "11".repeat(32),
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
  utun4: [iface("100.101.102.103")],
  en0: [iface("192.168.1.20")],
} as unknown as ReturnType<typeof networkInterfaces>;

describe("hostAddresses", () => {
  it("lists LAN before Tailscale, then the relay, skipping loopback", () => {
    expect(hostAddresses({ ...config, relayUrl: "https://relay.dev" }, 7420, interfaces)).toEqual([
      { label: "LAN", url: "ws://192.168.1.20:7420/connect" },
      { label: "Tailscale", url: "ws://100.101.102.103:7420/connect" },
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
    const info = pairingInfo(config, 7420, "p_one-time-code", interfaces);
    expect(info.token).toBe("p_one-time-code");
    expect(info.hostKey).toMatch(/^[0-9a-f]{64}$/);
    expect(parsePairingLink(encodePairingLink(info))).toEqual(info);
    const qr = await renderQr(encodePairingLink(info));
    expect(qr.split("\n").length).toBeGreaterThan(10);
  });
});

describe("manualCode", () => {
  it("carries the start of the key the QR code carries, after the code itself", () => {
    const parsed = parseManualCode(manualCode(config, "p_code"));
    expect(parsed).toEqual({ token: "p_code", hostKeyPrefix: pairingInfo(config, 7420, "p_code", interfaces).hostKey!.slice(0, 16) });
  });
});
