import { homedir } from "node:os";
import { join } from "node:path";
import type { Vendor } from "../vendor.ts";
import { claude, type ClaudeOptions } from "./claude/index.ts";
import { codex } from "./codex/index.ts";
import { pi } from "./pi/index.ts";

/** Where each harness keeps its files. */
export type VendorHomes = { claude: string; codex: string; pi: string };

export function defaultHomes(env: NodeJS.ProcessEnv = process.env, home = homedir()): VendorHomes {
  return {
    claude: env.CLAUDE_CONFIG_DIR || join(home, ".claude"),
    codex: env.CODEX_HOME || join(home, ".codex"),
    pi: join(home, ".pi", "agent"),
  };
}

export function defaultVendors(homes: VendorHomes = defaultHomes(), claudeOptions: Omit<ClaudeOptions, "home"> = {}): Vendor[] {
  return [claude({ home: homes.claude, ...claudeOptions }), codex({ home: homes.codex }), pi({ home: homes.pi })];
}
