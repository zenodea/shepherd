import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import type { Device, Pairing } from "../pairing/devices.ts";
import { generateKeyPair, publicKeyFor, fromHex, toHex, type KeyPair } from "@sheperd/protocol";
import { defaultSocketPath } from "../herdr/herdr-client.ts";
import type { NotifyConfig } from "../notifications/notifier.ts";

/** Persisted in ~/.config/sheperd/host.json (mode 0600). */
export type StoredConfig = {
  hostId: string;
  name: string;
  /** X25519 secret key (hex) identifying this host for end-to-end encryption. */
  hostKey?: string;
  /** Paired phones (token hashes only). */
  devices?: Device[];
  /** Outstanding one-time pairing codes (hashes only). */
  pairings?: Pairing[];
  /** Shared app token from before per-device pairing; migrated into `devices`. */
  token?: string;
  relayUrl?: string;
  /** Shared secret the host presents to the relay's control endpoint. */
  relayHostToken?: string;
  /** Push notifications through ntfy. */
  notify?: NotifyConfig;
};

export type HostConfig = StoredConfig & {
  configPath: string;
  port: number;
  bind: string;
  herdrBin: string;
  socketPath: string;
};

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SHEPERD_CONFIG) return env.SHEPERD_CONFIG;
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "sheperd", "host.json");
}

export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function readStoredConfig(path: string): StoredConfig | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as StoredConfig;
}

export function hostKeyPair(config: StoredConfig): KeyPair {
  if (!config.hostKey) throw new Error("host config has no hostKey");
  const secretKey = fromHex(config.hostKey);
  return { secretKey, publicKey: publicKeyFor(secretKey) };
}

export function loadOrCreateStoredConfig(path: string): StoredConfig {
  const existing = readStoredConfig(path);
  if (existing && !existing.hostKey) {
    // Configs from before end-to-end encryption get a host key on first run.
    existing.hostKey = toHex(generateKeyPair().secretKey);
    saveStoredConfig(path, existing);
  }
  if (existing) {
    if (!existing.token) return existing;
    // Keep phones paired with the old shared token working, as one revocable device.
    const { token, ...rest } = existing;
    const migrated: StoredConfig = {
      ...rest,
      devices: [
        ...(rest.devices ?? []),
        {
          id: "legacy",
          name: "Shared token (paired before per-device tokens)",
          tokenHash: createHash("sha256").update(token).digest("hex"),
          createdAt: new Date().toISOString(),
        },
      ],
    };
    saveStoredConfig(path, migrated);
    return migrated;
  }
  const config: StoredConfig = {
    hostId: generateSecret(9),
    name: hostname().replace(/\.local$/, ""),
    hostKey: toHex(generateKeyPair().secretKey),
    devices: [],
    pairings: [],
  };
  saveStoredConfig(path, config);
  return config;
}

/** Atomic write (temp file + rename), readable only by the owner. */
export function saveStoredConfig(path: string, config: StoredConfig): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** Stored config overlaid with environment overrides. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): HostConfig {
  const configPath = defaultConfigPath(env);
  const stored = loadOrCreateStoredConfig(configPath);
  const port = Number(env.SHEPERD_PORT ?? 7420);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`invalid SHEPERD_PORT: ${env.SHEPERD_PORT}`);
  return {
    ...stored,
    relayUrl: env.SHEPERD_RELAY_URL || stored.relayUrl,
    relayHostToken: env.SHEPERD_RELAY_HOST_TOKEN || stored.relayHostToken,
    configPath,
    port,
    bind: env.SHEPERD_BIND || "0.0.0.0",
    herdrBin: env.HERDR_BIN || "herdr",
    socketPath: defaultSocketPath(env),
  };
}
