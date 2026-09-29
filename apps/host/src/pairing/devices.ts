import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { unwatchFile, watchFile } from "node:fs";
import { generateSecret, readStoredConfig, saveStoredConfig, type StoredConfig } from "../system/config.ts";

/** A paired phone. Only a hash of its token is stored. */
export type Device = {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt?: string;
};

/** A one-time code shown in the pairing QR code. */
export type Pairing = {
  codeHash: string;
  expiresAt: string;
};

export const PAIRING_TTL_MS = 10 * 60_000;
const PAIRING_PREFIX = "p_";
const DEVICE_PREFIX = "d_";
const LAST_SEEN_RESOLUTION_MS = 60 * 60_000;

export type AuthResult =
  | { ok: true; device: Device; issuedToken?: string }
  | { ok: false; reason: "invalid" | "expired" };

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashesEqual(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isLive(pairing: Pairing, now: number): boolean {
  return Date.parse(pairing.expiresAt) > now;
}

type RegistryEvents = { changed: [] };

/**
 * Devices and pairing codes, kept in the host config file so the CLI
 * (`pair`, `devices revoke`) and the running host share them. Every write
 * re-reads the file first; the running host watches it for CLI changes.
 */
export class DeviceRegistry extends EventEmitter<RegistryEvents> {
  readonly configPath: string;
  private devices: Device[] = [];
  private pairings: Pairing[] = [];
  private watching = false;
  private readonly now: () => number;

  constructor(configPath: string, opts: { now?: () => number } = {}) {
    super();
    this.configPath = configPath;
    this.now = opts.now ?? Date.now;
    this.reload();
  }

  list(): Device[] {
    return [...this.devices];
  }

  get(id: string): Device | null {
    return this.devices.find((d) => d.id === id) ?? null;
  }

  /**
   * What the relay should admit. Apps show the relay `relayCredential(token)`,
   * which is exactly the stored token hash, and the relay compares its SHA-256
   * with these. So the relay never holds anything that works against the host.
   */
  clientTokenHashes(): string[] {
    const now = this.now();
    const credentials = [...this.devices.map((d) => d.tokenHash), ...this.pairings.filter((p) => isLive(p, now)).map((p) => p.codeHash)];
    return credentials.map(hashToken);
  }

  /** Create a one-time pairing code, valid for `ttlMs`. */
  createPairing(ttlMs = PAIRING_TTL_MS): { code: string; expiresAt: Date } {
    const code = `${PAIRING_PREFIX}${generateSecret(24)}`;
    const expiresAt = new Date(this.now() + ttlMs);
    this.update((cfg) => {
      cfg.pairings = [...(cfg.pairings ?? []).filter((p) => isLive(p, this.now())), { codeHash: hashToken(code), expiresAt: expiresAt.toISOString() }];
    });
    return { code, expiresAt };
  }

  /** Check a device token, or redeem a pairing code for a new device token. */
  authenticate(token: string, deviceName: string): AuthResult {
    const hash = hashToken(token);
    // A code from `pair` in another process may be newer than the last file-watch reload.
    const known = (h: string) => this.devices.some((d) => d.tokenHash === h) || this.pairings.some((p) => p.codeHash === h);
    if (!known(hash)) this.reload();
    const now = this.now();

    const device = this.devices.find((d) => hashesEqual(d.tokenHash, hash));
    if (device) {
      if (!device.lastSeenAt || now - Date.parse(device.lastSeenAt) > LAST_SEEN_RESOLUTION_MS) {
        this.update((cfg) => {
          const stored = cfg.devices?.find((d) => d.id === device.id);
          if (stored) stored.lastSeenAt = new Date(now).toISOString();
        });
      }
      return { ok: true, device: this.get(device.id) ?? device };
    }

    const pairing = this.pairings.find((p) => hashesEqual(p.codeHash, hash));
    // Pairing codes are `p_…`: an unknown one was used already or expired and was cleaned up.
    if (!pairing) return { ok: false, reason: token.startsWith(PAIRING_PREFIX) ? "expired" : "invalid" };
    if (!isLive(pairing, now)) return { ok: false, reason: "expired" };

    const issuedToken = `${DEVICE_PREFIX}${generateSecret()}`;
    const created: Device = {
      id: randomBytes(3).toString("hex"),
      name: deviceName,
      tokenHash: hashToken(issuedToken),
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
    };
    let redeemed = false;
    this.update((cfg) => {
      // Single use: only succeed if the code is still on disk (another process may have used it).
      const before = cfg.pairings?.length ?? 0;
      cfg.pairings = (cfg.pairings ?? []).filter((p) => p.codeHash !== pairing.codeHash && isLive(p, now));
      redeemed = (cfg.pairings.length ?? 0) < before;
      if (redeemed) cfg.devices = [...(cfg.devices ?? []), created];
    });
    return redeemed ? { ok: true, device: created, issuedToken } : { ok: false, reason: "expired" };
  }

  /** Remove a device (or every device with "all"). Returns how many were removed. */
  revoke(id: string): number {
    let removed = 0;
    this.update((cfg) => {
      const before = cfg.devices?.length ?? 0;
      cfg.devices = id === "all" ? [] : (cfg.devices ?? []).filter((d) => d.id !== id);
      removed = before - cfg.devices.length;
    });
    return removed;
  }

  /** Pick up changes other processes make to the config file. */
  watch(intervalMs = 1000): void {
    if (this.watching) return;
    this.watching = true;
    watchFile(this.configPath, { interval: intervalMs }, () => this.reload());
  }

  unwatch(): void {
    if (!this.watching) return;
    this.watching = false;
    unwatchFile(this.configPath);
  }

  reload(): void {
    const cfg = readStoredConfig(this.configPath);
    const devices = cfg?.devices ?? [];
    const pairings = cfg?.pairings ?? [];
    const changed = JSON.stringify([devices, pairings]) !== JSON.stringify([this.devices, this.pairings]);
    this.devices = devices;
    this.pairings = pairings;
    if (changed) this.emit("changed");
  }

  private update(fn: (cfg: StoredConfig) => void): void {
    const cfg = readStoredConfig(this.configPath);
    if (!cfg) throw new Error(`missing host config at ${this.configPath}`);
    fn(cfg);
    saveStoredConfig(this.configPath, cfg);
    this.reload();
  }
}
