// Will a firewall on this computer drop a phone before it reaches the host? Only firewalld is
// checked: it's the usual one on Fedora and Arch, and asking it needs no root. An interface
// that isn't in any zone lands in the default zone, which on most installs only lets in ssh.
import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import type { HostAddress } from "../pairing/pairing.ts";

export type FirewallBlock = { label: HostAddress["label"]; iface: string; zone: string; fix: string };

/** firewall-cmd's output, or null when it failed or isn't installed. */
export type FirewallCmd = (args: string[]) => Promise<string | null>;

type Interfaces = ReturnType<typeof networkInterfaces>;

const runOnce: FirewallCmd = (args) =>
  new Promise((resolve) => {
    execFile("firewall-cmd", args, { timeout: 5000 }, (err, stdout) => resolve(err ? null : stdout.trim()));
  });

// firewalld now and then misses a D-Bus reply ("Did not receive a reply"), so ask twice.
const firewallCmd: FirewallCmd = async (args) => (await runOnce(args)) ?? runOnce(args);

/** True when the zone lets `port`/tcp in: it accepts everything, or the port is in its ports. */
export function zoneAllows(listAll: string, port: number): boolean {
  const field = (name: string) => listAll.match(new RegExp(`^\\s*${name}:(.*)$`, "m"))?.[1]?.trim() ?? "";
  if (field("target") === "ACCEPT") return true;
  return field("ports")
    .split(/\s+/)
    .some((entry) => {
      const m = entry.match(/^(\d+)(?:-(\d+))?\/tcp$/);
      return !!m && Number(m[1]) <= port && port <= Number(m[2] ?? m[1]);
    });
}

/** The LAN and Tailscale addresses whose interface firewalld won't let `port` in on. */
export async function firewallBlocks(
  addresses: HostAddress[],
  port: number,
  run: FirewallCmd = firewallCmd,
  interfaces: Interfaces = networkInterfaces(),
  platform: NodeJS.Platform = process.platform,
): Promise<FirewallBlock[]> {
  if (platform !== "linux") return [];
  // Only answers while firewalld is running.
  const defaultZone = await run(["--get-default-zone"]);
  if (!defaultZone) return [];

  const blocks: FirewallBlock[] = [];
  const seen = new Set<string>();
  for (const { label, url } of addresses) {
    if (label === "Relay") continue;
    const ip = new URL(url).hostname;
    const iface = Object.entries(interfaces).find(([, addrs]) => addrs?.some((a) => a.address === ip))?.[0];
    if (!iface || seen.has(iface)) continue;
    seen.add(iface);
    const zone = (await run([`--get-zone-of-interface=${iface}`])) ?? defaultZone;
    const listAll = await run([`--zone=${zone}`, "--list-all"]);
    if (listAll === null || zoneAllows(listAll, port)) continue;
    const fix = `sudo firewall-cmd --permanent --zone=${zone} --add-port=${port}/tcp && sudo firewall-cmd --reload`;
    blocks.push({ label, iface, zone, fix });
  }
  return blocks;
}
