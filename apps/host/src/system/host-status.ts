// What the running host is doing right now, for the Shepherd window in herdr:
// which phones are connected and the relay. The host writes it
// next to its config whenever something changes; the window reads it.
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HostAddress } from "../pairing/pairing.ts";
import { writeJsonAtomic } from "./config.ts";

export type ConnectedPhone = { deviceId: string; via: "direct" | "relay"; since: string };

export type HostStatus = {
  pid: number;
  startedAt: string;
  herdr: { version: string; socketPath: string };
  port: number;
  addresses: HostAddress[];
  agents: { total: number; blocked: number; working: number };
  phones: ConnectedPhone[];
  relay: { state: string; detail?: string } | null;
  updatedAt: string;
};

export function hostStatusPath(configPath: string): string {
  return join(dirname(configPath), "status.json");
}

/** The status the host last wrote, or null if there's none or it's from a host that has since exited. */
export function readHostStatus(configPath: string, runningPid: number | null): HostStatus | null {
  try {
    const status = JSON.parse(readFileSync(hostStatusPath(configPath), "utf8")) as HostStatus;
    return status.pid === runningPid ? status : null;
  } catch {
    return null;
  }
}

const WRITE_DELAY_MS = 100;

export class HostStatusWriter {
  private readonly path: string;
  private status: HostStatus;
  private timer: NodeJS.Timeout | null = null;
  private nextId = 0;
  private readonly phones = new Map<number, ConnectedPhone>();

  constructor(configPath: string, initial: Omit<HostStatus, "pid" | "startedAt" | "phones" | "updatedAt">) {
    this.path = hostStatusPath(configPath);
    this.status = { ...initial, pid: process.pid, startedAt: new Date().toISOString(), phones: [], updatedAt: "" };
    this.write();
  }

  update(patch: Partial<Pick<HostStatus, "agents" | "relay" | "addresses">>): void {
    const next = { ...this.status, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    this.schedule();
  }

  /** Record a phone as connected; call the returned function when it disconnects. */
  connected(deviceId: string, via: ConnectedPhone["via"]): () => void {
    const id = ++this.nextId;
    this.phones.set(id, { deviceId, via, since: new Date().toISOString() });
    this.schedule();
    return () => {
      if (this.phones.delete(id)) this.schedule();
    };
  }

  /** Remove the file, so the window doesn't show a stopped host's phones as connected. */
  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    rmSync(this.path, { force: true });
  }

  private schedule(): void {
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.write();
    }, WRITE_DELAY_MS);
  }

  private write(): void {
    this.status = { ...this.status, phones: [...this.phones.values()], updatedAt: new Date().toISOString() };
    try {
      writeJsonAtomic(this.path, this.status);
    } catch (err) {
      // Only the Shepherd window reads it: never take the host down over it.
      console.error(`[status] couldn't write ${this.path}: ${(err as Error).message}`);
    }
  }
}
