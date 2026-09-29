export type AddressKind = "Tailscale" | "Relay" | "Wi-Fi";

/** How a host URL is reached: Tailscale (100.64.0.0/10), the relay (wss), or the local network. */
export function addressKind(url: string): AddressKind {
  if (url.startsWith("wss://")) return "Relay";
  const host = /^wss?:\/\/([^/:]+)/.exec(url)?.[1] ?? "";
  const [a, b] = host.split(".").map(Number);
  if (a === 100 && b! >= 64 && b! <= 127) return "Tailscale";
  if (host.endsWith(".ts.net")) return "Tailscale";
  return "Wi-Fi";
}

export function addressHost(url: string): string {
  return /^wss?:\/\/([^/]+)/.exec(url)?.[1] ?? url;
}
