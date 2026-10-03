// Which transcript file belongs to an agent's pane. herdr reports the path for
// some harnesses (its pi integration). For Claude Code, the running process in
// the pane says which session it's on. Otherwise it's the newest session the
// harness wrote for the pane's working directory.
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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

/** A running Claude Code, from the file it keeps in ~/.claude/sessions/<pid>.json. */
export type ClaudeProcess = { pid: number; sessionId: string; cwd: string; startedAt: number };

/** How to find running agents and their panes; replaced in tests. */
export type Processes = {
  /** Running Claude Codes. */
  claude(roots: Roots): ClaudeProcess[];
  /** The herdr pane a process runs in (its HERDR_PANE_ID), or null. */
  paneOf(pid: number): string | null;
};

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists, it just isn't ours.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** A process's HERDR_PANE_ID: /proc on Linux, `ps eww` on macOS. */
function readPaneOf(pid: number): string | null {
  try {
    const env =
      process.platform === "linux"
        ? readFileSync(`/proc/${pid}/environ`, "utf8").replace(/\0/g, " ")
        : execFileSync("ps", ["eww", "-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
    return /(?:^|\s)HERDR_PANE_ID=(\S+)/.exec(env)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Pane ids by process (and when it started, as pids get reused): a process doesn't change pane. */
const panes = new Map<string, string | null>();

export const systemProcesses: Processes = {
  claude(roots) {
    const dir = join(dirname(roots.claude), "sessions");
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    const found: ClaudeProcess[] = [];
    for (const name of names) {
      if (!/^\d+\.json$/.test(name)) continue;
      try {
        const j = JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
        const { pid, sessionId, cwd, startedAt } = j;
        if (typeof pid === "number" && typeof sessionId === "string" && typeof cwd === "string" && isAlive(pid)) {
          found.push({ pid, sessionId, cwd, startedAt: typeof startedAt === "number" ? startedAt : 0 });
        }
      } catch {
        // being rewritten, or not one of these
      }
    }
    return found;
  },
  paneOf(pid) {
    const key = String(pid);
    if (!panes.has(key)) {
      if (panes.size > 500) panes.clear();
      panes.set(key, readPaneOf(pid));
    }
    return panes.get(key)!;
  },
};

/** The transcript of a Claude session, by the folder it started in. */
const claudeTranscript = (roots: Roots, p: ClaudeProcess) => join(roots.claude, claudeProjectDir(p.cwd), `${p.sessionId}.jsonl`);

export function locateTranscript(agent: AgentInfo, harness: Harness, roots: Roots = defaultRoots(), processes: Processes = systemProcesses): string | null {
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
      }
      // The Claude running in this pane says which session it's on (it changes with /clear and /resume).
      const running = processes.claude(roots);
      const mine = running.filter((p) => processes.paneOf(p.pid) === agent.pane_id).sort((a, b) => b.startedAt - a.startedAt)[0];
      if (mine) {
        const path = claudeTranscript(roots, mine);
        // A brand-new session has no transcript until its first message: nothing yet, rather than another session's.
        return existsSync(path) ? path : null;
      }
      // Otherwise the newest session in the folder, leaving out those another running Claude is on.
      const taken = new Set(running.map((p) => claudeTranscript(roots, p)));
      for (const cwd of cwds) {
        const newest = jsonlFiles(join(roots.claude, claudeProjectDir(cwd))).find((f) => !taken.has(f.path));
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
