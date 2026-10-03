import { homedir } from "node:os";
import { join } from "node:path";
import type { Vendor } from "../vendor.ts";
import { claude, type ClaudeOptions } from "./claude/index.ts";
import { codex } from "./codex/index.ts";
import { gemini } from "./gemini/index.ts";
import { hermes } from "./hermes/index.ts";
import { opencode } from "./opencode/index.ts";
import { pi } from "./pi/index.ts";

/** Where each harness keeps its files. */
export type VendorHomes = {
  claude: string;
  codex: string;
  pi: string;
  gemini: string;
  /** OpenCode's data and cache folders (XDG). */
  opencode: { data: string; cache: string; db?: string };
  hermes: string;
};

export function defaultHomes(env: NodeJS.ProcessEnv = process.env, home = homedir()): VendorHomes {
  return {
    claude: env.CLAUDE_CONFIG_DIR || join(home, ".claude"),
    codex: env.CODEX_HOME || join(home, ".codex"),
    pi: join(home, ".pi", "agent"),
    gemini: join(env.GEMINI_CLI_HOME || home, ".gemini"),
    opencode: {
      data: join(env.XDG_DATA_HOME || join(home, ".local", "share"), "opencode"),
      cache: join(env.XDG_CACHE_HOME || join(home, ".cache"), "opencode"),
      ...(env.OPENCODE_DB ? { db: env.OPENCODE_DB } : {}),
    },
    hermes: env.HERMES_HOME || join(home, ".hermes"),
  };
}

export function defaultVendors(homes: VendorHomes = defaultHomes(), claudeOptions: Omit<ClaudeOptions, "home"> = {}): Vendor[] {
  return [
    claude({ home: homes.claude, ...claudeOptions }),
    codex({ home: homes.codex }),
    pi({ home: homes.pi }),
    gemini({ home: homes.gemini }),
    opencode(homes.opencode),
    hermes({ home: homes.hermes }),
  ];
}
