import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentInfo, SubagentStatus } from "@shepherd/protocol";
import { isRecord, str } from "../../entries.ts";
import { cwdsOf, firstRecord, jsonlFiles, lastRecords, modifiedAt } from "../../files.ts";
import { isAlive, paneOfProcess } from "../../panes.ts";
import { STALE_MS, type SubagentSource, type Vendor } from "../../vendor.ts";
import { claudeParser, claudeProjectDir } from "./parser.ts";

/** A running Claude Code, from the file it keeps in <home>/sessions/<pid>.json. */
export type ClaudeSession = { pid: number; sessionId: string; cwd: string; startedAt: number };

export type ClaudeOptions = {
  /** ~/.claude, or CLAUDE_CONFIG_DIR. */
  home: string;
  running?: () => ClaudeSession[];
  paneOf?: (pid: number) => string | null;
};

function runningSessions(dir: string): ClaudeSession[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (!/^\d+\.json$/.test(name)) return [];
    try {
      const { pid, sessionId, cwd, startedAt } = JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
      if (typeof pid !== "number" || typeof sessionId !== "string" || typeof cwd !== "string" || !isAlive(pid)) return [];
      return [{ pid, sessionId, cwd, startedAt: typeof startedAt === "number" ? startedAt : 0 }];
    } catch {
      return [];
    }
  });
}

const handsBack = (content: unknown) => Array.isArray(content) && content.some((b) => isRecord(b) && b.type === "tool_use" && b.name === "SubagentHandback");

function status(transcript: string): SubagentStatus {
  const reply = lastRecords(transcript).find((r) => r.type === "assistant" && isRecord(r.message));
  const message = reply && isRecord(reply.message) ? reply.message : null;
  if (message && (message.stop_reason === "end_turn" || handsBack(message.content))) return "done";
  return Date.now() - (modifiedAt(transcript) ?? 0) > STALE_MS ? "stopped" : "running";
}

function subagents(transcript: string): SubagentSource[] {
  const dir = join(transcript.replace(/\.jsonl$/, ""), "subagents");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name): SubagentSource[] => {
    const id = /^agent-([\w-]+)\.meta\.json$/.exec(name)?.[1];
    const path = join(dir, `agent-${id}.jsonl`);
    if (!id || !existsSync(path)) return [];
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
    } catch {
      return [];
    }
    const toolUseId = str(meta.toolUseId);
    return [
      {
        id,
        name: str(meta.description) ?? "Subagent",
        kind: str(meta.agentType) ?? null,
        depth: typeof meta.spawnDepth === "number" ? meta.spawnDepth : 1,
        startedAt: str(firstRecord(path)?.timestamp) ?? null,
        transcript: path,
        parser: () => claudeParser({ subagent: true }),
        status: () => status(path),
        startedBy: (call) => toolUseId !== undefined && call.callId === toolUseId,
      },
    ];
  });
}

export function claude({ home, running = () => runningSessions(join(home, "sessions")), paneOf = paneOfProcess }: ClaudeOptions): Vendor {
  const projects = join(home, "projects");
  const transcriptOf = (s: ClaudeSession) => join(projects, claudeProjectDir(s.cwd), `${s.sessionId}.jsonl`);

  const locate = (agent: AgentInfo): string | null => {
    const reported = agent.agent_session?.kind === "id" ? agent.agent_session.value : null;
    for (const cwd of cwdsOf(agent)) {
      const path = join(projects, claudeProjectDir(cwd), `${reported}.jsonl`);
      if (reported && existsSync(path)) return path;
    }
    const sessions = running();
    const mine = sessions.filter((s) => paneOf(s.pid) === agent.pane_id).sort((a, b) => b.startedAt - a.startedAt)[0];
    // A new session has no transcript until its first message: nothing yet, rather than someone else's.
    if (mine) return existsSync(transcriptOf(mine)) ? transcriptOf(mine) : null;
    const taken = new Set(sessions.map(transcriptOf));
    for (const cwd of cwdsOf(agent)) {
      const newest = jsonlFiles(join(projects, claudeProjectDir(cwd))).find((f) => !taken.has(f.path));
      if (newest) return newest.path;
    }
    return null;
  };

  return {
    id: "claude",
    locate,
    parser: () => claudeParser(),
    queued: (_transcript, reader) => reader.queued() ?? [],
    subagents,
  };
}
