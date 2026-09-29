import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { defaultSocketPath } from "./herdr-client.ts";

/** Persisted in ~/.config/sheperd/host.json (mode 0600). */
export type StoredConfig = {
  hostId: string;
  /** Bearer token the app presents to this host. */
  token: string;
  name: string;
  relayUrl?: string;
  /** Shared secret the host presents to the relay's control endpoint. */
  relayHostToken?: string;
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

export function loadOrCreateStoredConfig(path: string): StoredConfig {
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf8")) as StoredConfig;
  }
  const config: StoredConfig = {
    hostId: generateSecret(9),
    token: generateSecret(),
    name: hostname().replace(/\.local$/, ""),
  };
  saveStoredConfig(path, config);
  return config;
}

export function saveStoredConfig(path: string, config: StoredConfig): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Stored config overlaid with environment overrides. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): HostConfig {
  const configPath = defaultConfigPath(env);
  const stored = loadOrCreateStoredConfig(configPath);
  const port = Number(env.SHEPERD_PORT ?? 7420);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`invalid SHEPERD_PORT: ${env.SHEPERD_PORT}`);
  return {
    ...stored,
    token: env.SHEPERD_TOKEN || stored.token,
    relayUrl: env.SHEPERD_RELAY_URL || stored.relayUrl,
    relayHostToken: env.SHEPERD_RELAY_HOST_TOKEN || stored.relayHostToken,
    configPath,
    port,
    bind: env.SHEPERD_BIND || "0.0.0.0",
    herdrBin: env.HERDR_BIN || "herdr",
    socketPath: defaultSocketPath(env),
  };
}
