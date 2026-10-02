// Which transcript file belongs to an agent's pane. herdr reports the path for
// some harnesses (its pi integration); otherwise it's the newest session the
// harness wrote for the pane's working directory.
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentInfo } from "@shepherd/protocol";
import { claudeProjectDir } from "./claude.ts";
import { piSessionDir } from "./pi.ts";

export const HARNESSES = ["claude", "codex", "pi"] as const;
export type Harness = (typeof HARNESSES)[number];

export function harnessOf(agent: AgentInfo): Harness | null {
  const kind = agent.agent ?? agent.agent_session?.agent ?? "";
  return (HARNESSES as readonly string[]).includes(kind) ? (kind as Harness) : null;
}

export type Roots = { claude: string; codex: string; pi: string };

export function defaultRoots(env: NodeJS.ProcessEnv = process.env, home = homedir()): Roots {
  return {
    claude: join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "projects"),
    codex: join(env.CODEX_HOME || join(home, ".codex"), "sessions"),
    pi: join(home, ".pi", "agent", "sessions"),
  };
}

function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

type File = { path: string; mtimeMs: number };

function jsonlFiles(dir: string): File[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const files: File[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    try {
      const stat = statSync(path);
      if (stat.isFile()) files.push({ path, mtimeMs: stat.mtimeMs });
    } catch {
      // gone since the listing
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

const FIRST_LINE_LIMIT = 128 * 1024;
const firstLines = new Map<string, Record<string, unknown> | null>();

/** The first JSON line of a file (a session header), cached: headers don't change. */
function firstLine(path: string): Record<string, unknown> | null {
  if (firstLines.has(path)) return firstLines.get(path)!;
  let result: Record<string, unknown> | null = null;
  try {
    const fd = openSync(path, "r");
    try {
      const buffer = Buffer.alloc(FIRST_LINE_LIMIT);
      const read = readSync(fd, buffer, 0, buffer.length, 0);
      const nl = buffer.subarray(0, read).indexOf(0x0a);
      if (nl !== -1) result = JSON.parse(buffer.subarray(0, nl).toString("utf8")) as Record<string, unknown>;
    } finally {
      closeSync(fd);
    }
  } catch {
    result = null;
  }
  if (firstLines.size > 2000) firstLines.clear();
  firstLines.set(path, result);
  return result;
}

function cwdsOf(agent: AgentInfo): string[] {
  return [...new Set([agent.cwd, agent.foreground_cwd].filter((c): c is string => typeof c === "string" && c.startsWith("/")))];
}

/** Day folders from today back, named in local time like Codex names them. */
function recentDayDirs(root: string, days: number, now = new Date()): string[] {
  const dirs: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    dirs.push(join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")));
  }
  return dirs;
}

const CODEX_DAYS = 7;

export function locateTranscript(agent: AgentInfo, harness: Harness, roots: Roots = defaultRoots()): string | null {
  const session = agent.agent_session;
  if (session?.kind === "path") {
    const path = expandHome(session.value);
    if (existsSync(path)) return path;
  }
  const cwds = cwdsOf(agent);

  switch (harness) {
    case "claude": {
      for (const cwd of cwds) {
        const dir = join(roots.claude, claudeProjectDir(cwd));
        if (session?.kind === "id" && existsSync(join(dir, `${session.value}.jsonl`))) return join(dir, `${session.value}.jsonl`);
        const newest = jsonlFiles(dir)[0];
        if (newest) return newest.path;
      }
      return null;
    }
    case "pi": {
      for (const cwd of cwds) {
        // Subagents write their own sessions into the same folder; they name a parent.
        const main = jsonlFiles(join(roots.pi, piSessionDir(cwd))).find((f) => !firstLine(f.path)?.parentSession);
        if (main) return main.path;
      }
      return null;
    }
    case "codex": {
      const files = recentDayDirs(roots.codex, CODEX_DAYS).flatMap((dir) => jsonlFiles(dir));
      files.sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (session?.kind === "id") {
        const byId = files.find((f) => f.path.endsWith(`${session.value}.jsonl`));
        if (byId) return byId.path;
      }
      for (const file of files) {
        const meta = firstLine(file.path);
        const payload = meta?.payload as Record<string, unknown> | undefined;
        // Subagent threads have an object `source`.
        if (meta?.type === "session_meta" && typeof payload?.source === "string" && cwds.includes(String(payload.cwd))) return file.path;
      }
      return null;
    }
  }
}
