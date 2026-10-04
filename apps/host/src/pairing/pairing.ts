import { networkInterfaces } from "node:os";
import QRCode from "qrcode";
import { encodePairingLink, formatManualCode, toHex, type PairingInfo } from "@shepherd/protocol";
import { hostCommand, hostKeyPair, type HostConfig } from "../system/config.ts";
import type { DeviceRegistry } from "./devices.ts";
import { appRelayUrl } from "../connection/relay-tunnel.ts";
import { isTailscale, routesOf } from "../connection/routes.ts";

export type HostAddress = { label: "LAN" | "Tailscale" | "Relay"; url: string };

type Interfaces = ReturnType<typeof networkInterfaces>;

/** Every URL the app could use to reach this host, best first, on the routes that are on. */
export function hostAddresses(config: HostConfig, port: number, interfaces: Interfaces = networkInterfaces()): HostAddress[] {
  const routes = routesOf(config);
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
    .filter((a) => (a.label === "Tailscale" ? routes.tailscale : routes.lan))
    .sort((a, b) => Number(a.label === "Tailscale") - Number(b.label === "Tailscale"));
  if (config.relayUrl && routes.relay) addresses.push({ label: "Relay", url: appRelayUrl(config.relayUrl, config.hostId) });
  return addresses;
}

/** `credential` is a one-time pairing code from DeviceRegistry.createPairing. */
export function pairingInfo(config: HostConfig, port: number, credential: string, interfaces?: Interfaces): PairingInfo {
  return {
    name: config.name,
    token: credential,
    urls: hostAddresses(config, port, interfaces).map((a) => a.url),
    hostKey: toHex(hostKeyPair(config).publicKey),
  };
}

/** The code to type when the QR code can't be scanned, with the start of the host key so the app can check it. */
export function manualCode(config: HostConfig, code: string): string {
  return formatManualCode(code, toHex(hostKeyPair(config).publicKey));
}

export function renderQr(text: string): Promise<string> {
  return QRCode.toString(text, { type: "terminal", small: true, errorCorrectionLevel: "L" });
}

function printAddresses(config: HostConfig, port: number): void {
  console.log(`  Host:      ${config.name} (${config.hostId})`);
  for (const { label, url } of hostAddresses(config, port)) console.log(`  ${`${label}:`.padEnd(10)} ${url}`);
}

/** Create a one-time pairing code and print it as a QR code. */
export async function printPairing(config: HostConfig, devices: DeviceRegistry, port = config.port): Promise<void> {
  if (hostAddresses(config, port).length === 0) {
    console.log("\n  No reachable address: set SHEPHERD_BIND to a LAN/Tailscale IP or configure a relay.\n");
    return;
  }
  const { code, expiresAt } = devices.createPairing();
  console.log("\n  Scan with the Shepherd app (Host → Scan QR code) to pair a phone:\n");
  const qr = await renderQr(encodePairingLink(pairingInfo(config, port, code)));
  console.log(qr.trimEnd().replace(/^/gm, "  ") + "\n");
  console.log(`  One-time code, valid until ${expiresAt.toLocaleTimeString()}. For another: ${hostCommand("pair")}\n`);
  printAddresses(config, port);
  console.log(`  Code:      ${manualCode(config, code)}   (for manual entry)`);
  console.log("");
}

export function printDevices(devices: DeviceRegistry): void {
  const list = devices.list();
  if (list.length === 0) {
    console.log(`  No paired devices. Pair one with: ${hostCommand("pair")}`);
    return;
  }
  console.log("  Paired devices:");
  for (const d of list) {
    const seen = d.lastSeenAt ? `last seen ${new Date(d.lastSeenAt).toLocaleString()}` : "never connected";
    console.log(`    ${d.id.padEnd(8)} ${d.name}  (${seen})`);
  }
  console.log(`  Remove one with: ${hostCommand("devices revoke <id>")}`);
}

export function printHostInfo(config: HostConfig, devices: DeviceRegistry, port = config.port): void {
  console.log("");
  printAddresses(config, port);
  console.log(`  Config:    ${config.configPath}\n`);
  printDevices(devices);
  console.log("");
}
