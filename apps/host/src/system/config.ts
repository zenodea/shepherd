import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import type { Device, Pairing } from "../pairing/devices.ts";
import { generateKeyPair, publicKeyFor, fromHex, toHex, type KeyPair } from "@shepherd/protocol";
import { defaultSocketPath } from "../herdr/herdr-client.ts";
import type { NotifyConfig } from "../notifications/notifier.ts";

/** Persisted in ~/.config/shepherd/host.json (mode 0600). */
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
  /** Notifications that were turned off, kept so turning them back on reuses the topic your phone subscribed to. */
  pausedNotify?: NotifyConfig;
  /** Turned off in the Shepherd window: the herdr plugin doesn't start the host. */
  disabled?: boolean;
};

export type HostConfig = StoredConfig & {
  configPath: string;
  port: number;
  bind: string;
  herdrBin: string;
  socketPath: string;
};

/**
 * `SHEPHERD_<name>`, or the variable from before the project was renamed
 * (it was misspelled "sheperd"), so existing setups keep working.
 */
export function envVar(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[`SHEPHERD_${name}`] ?? env[`SHEPERD_${name}`];
}

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = envVar(env, "CONFIG");
  if (explicit) return explicit;
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const dir = join(base, "shepherd");
  // Move the config folder from before the rename; it holds the host's key and paired phones.
  const old = join(base, "sheperd");
  if (!existsSync(dir) && existsSync(old)) {
    try {
      renameSync(old, dir);
    } catch {
      return join(old, "host.json");
    }
  }
  return join(dir, "host.json");
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
  const port = Number(envVar(env, "PORT") ?? 7420);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`invalid SHEPHERD_PORT: ${envVar(env, "PORT")}`);
  return {
    ...stored,
    relayUrl: envVar(env, "RELAY_URL") || stored.relayUrl,
    relayHostToken: envVar(env, "RELAY_HOST_TOKEN") || stored.relayHostToken,
    configPath,
    port,
    bind: envVar(env, "BIND") || "0.0.0.0",
    // HERDR_BIN_PATH is the running herdr binary, set by herdr for plugin commands.
    herdrBin: env.HERDR_BIN || env.HERDR_BIN_PATH || "herdr",
    socketPath: defaultSocketPath(env),
  };
}

/**
 * How to run a host command, for hints in the output. Installed as a herdr
 * plugin there's no repo checkout to run `npm run host` in.
 */
export function hostCommand(args: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!env.HERDR_PLUGIN_ROOT) return `npm run host -- ${args}`;
  if (args === "pair") return `herdr plugin action invoke ${env.HERDR_PLUGIN_ID ?? "shepherd"}.pair`;
  return `node ${join(env.HERDR_PLUGIN_ROOT, "apps", "host", "src", "cli.ts")} ${args}`;
}

export const DEFAULT_NTFY_SERVER = "https://ntfy.sh";

/** Turn notifications on, reusing the topic from before if they were on with this server. */
export function enableNotifications(configPath: string, server = DEFAULT_NTFY_SERVER): NotifyConfig {
  new URL(server); // throws on a bad URL
  const stored = loadOrCreateStoredConfig(configPath);
  const previous = [stored.notify, stored.pausedNotify].find((n) => n?.server === server);
  const notify = previous ?? { server, topic: `shepherd-${generateSecret(15)}` };
  const { pausedNotify: _paused, ...rest } = stored;
  saveStoredConfig(configPath, { ...rest, notify });
  return notify;
}

export function disableNotifications(configPath: string): void {
  const { notify, ...rest } = loadOrCreateStoredConfig(configPath);
  saveStoredConfig(configPath, notify ? { ...rest, pausedNotify: notify } : rest);
}

export function setDisabled(configPath: string, disabled: boolean): void {
  const { disabled: _was, ...rest } = loadOrCreateStoredConfig(configPath);
  saveStoredConfig(configPath, disabled ? { ...rest, disabled: true } : rest);
}
