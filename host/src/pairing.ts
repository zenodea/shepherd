import { networkInterfaces } from "node:os";
import QRCode from "qrcode";
import { encodePairingLink, type PairingInfo } from "@sheperd/protocol";
import type { HostConfig } from "./config.ts";
import { appRelayUrl } from "./relay-tunnel.ts";

export type HostAddress = { label: "LAN" | "Tailscale" | "Relay"; url: string };

type Interfaces = ReturnType<typeof networkInterfaces>;

/** Tailscale hands out addresses from the CGNAT range 100.64.0.0/10. */
function isTailscale(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 100 && b! >= 64 && b! <= 127;
}

/** Every URL the app could use to reach this host, best first. */
export function hostAddresses(config: HostConfig, port: number, interfaces: Interfaces = networkInterfaces()): HostAddress[] {
  const ips =
    config.bind === "0.0.0.0"
      ? Object.values(interfaces)
          .flat()
          .filter((i) => i && i.family === "IPv4" && !i.internal)
          .map((i) => i!.address)
      : config.bind === "127.0.0.1" || config.bind === "localhost"
        ? []
        : [config.bind];

  const addresses: HostAddress[] = ips
    .map((ip): HostAddress => ({ label: isTailscale(ip) ? "Tailscale" : "LAN", url: `ws://${ip}:${port}/connect` }))
    .sort((a, b) => Number(a.label === "Tailscale") - Number(b.label === "Tailscale"));
  if (config.relayUrl) addresses.push({ label: "Relay", url: appRelayUrl(config.relayUrl, config.hostId) });
  return addresses;
}

export function pairingInfo(config: HostConfig, port: number, interfaces?: Interfaces): PairingInfo {
  return { name: config.name, token: config.token, urls: hostAddresses(config, port, interfaces).map((a) => a.url) };
}

export function renderQr(text: string): Promise<string> {
  return QRCode.toString(text, { type: "terminal", small: true, errorCorrectionLevel: "L" });
}

export async function printConnectionInfo(config: HostConfig, port = config.port): Promise<void> {
  const addresses = hostAddresses(config, port);
  const info = pairingInfo(config, port);

  if (addresses.length > 0) {
    console.log("\n  Scan with the sheperd app (Connect → Scan QR code):\n");
    const qr = await renderQr(encodePairingLink(info));
    console.log(qr.trimEnd().replace(/^/gm, "  ") + "\n");
  } else {
    console.log("\n  No reachable address: set SHEPERD_BIND to a LAN/Tailscale IP or configure a relay.");
  }

  console.log(`  Host:      ${config.name} (${config.hostId})`);
  for (const { label, url } of addresses) console.log(`  ${`${label}:`.padEnd(10)} ${url}`);
  console.log(`  Token:     ${config.token}`);
  console.log(`  Config:    ${config.configPath}\n`);
}
