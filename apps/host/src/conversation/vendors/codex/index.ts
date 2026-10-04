import { statSync } from "node:fs";
import { join } from "node:path";
import type { AgentInfo, SubagentStatus } from "@shepherd/protocol";
import { isRecord, str, type Parser } from "../../entries.ts";
import { cwdsOf, firstRecord, jsonlFiles, lastRecords, modifiedAt, recentDayDirs } from "../../files.ts";
import { TAIL_BYTES, TranscriptReader } from "../../reader.ts";
import { STALE_MS, type SubagentSource, type Vendor } from "../../vendor.ts";
import { codexParser } from "./parser.ts";
import { codexQueue, codexThreadId } from "./queue.ts";

const DAYS = 7;

type Spawn = { parent_thread_id?: unknown; depth?: unknown; agent_path?: unknown; agent_nickname?: unknown; agent_role?: unknown };

function header(path: string): { id: string | null; cwd: string | null; source: unknown; timestamp: string | null } | null {
  const record = firstRecord(path);
  if (record?.type !== "session_meta" || !isRecord(record.payload)) return null;
  const p = record.payload;
  return { id: str(p.id) ?? codexThreadId(path), cwd: str(p.cwd) ?? null, source: p.source, timestamp: str(p.timestamp) ?? null };
}

/** Threads Codex spawned as subagents; not its own helper threads (e.g. the approval "guardian"). */
function spawnOf(source: unknown): Spawn | null {
  if (!isRecord(source) || !isRecord(source.subagent) || !isRecord(source.subagent.thread_spawn)) return null;
  return source.subagent.thread_spawn as Spawn;
}

function status(transcript: string): SubagentStatus {
  for (const r of lastRecords(transcript)) {
    const type = r.type === "event_msg" && isRecord(r.payload) ? r.payload.type : null;
    if (type === "task_complete") return "done";
    if (type === "turn_aborted") return "stopped";
    if (type === "task_started") break;
  }
  return Date.now() - (modifiedAt(transcript) ?? 0) > STALE_MS ? "stopped" : "running";
}

/** A subagent's file starts with a copy of its parent's history; its own work starts at its first task. */
function ownWork(parse: Parser, agentPath: string): Parser {
  let started = false;
  const own = (record: Record<string, unknown>) => {
    const p = record.payload;
    if (!started && isRecord(p) && p.type === "agent_message" && p.recipient === agentPath) started = true;
    return started ? parse(record) : [];
  };
  return Object.assign(own, { context: parse.context });
}

export function codex({ home }: { home: string }): Vendor {
  const sessions = join(home, "sessions");
  const queuePath = join(home, "queue_1.sqlite");
  const recentFiles = () => recentDayDirs(sessions, DAYS).flatMap(jsonlFiles);

  const locate = (agent: AgentInfo): string | null => {
    const files = recentFiles().sort((a, b) => b.mtimeMs - a.mtimeMs);
    const reported = agent.agent_session?.kind === "id" ? agent.agent_session.value : null;
    const byId = reported ? files.find((f) => f.path.endsWith(`${reported}.jsonl`)) : undefined;
    if (byId) return byId.path;
    const cwds = cwdsOf(agent);
    for (const file of files) {
      const h = header(file.path);
      if (h && typeof h.source === "string" && h.cwd && cwds.includes(h.cwd)) return file.path;
    }
    return null;
  };

  const subagents = (transcript: string): SubagentSource[] => {
    const root = header(transcript)?.id;
    if (!root) return [];
    const children = recentFiles().flatMap((file) => {
      const h = header(file.path);
      const spawn = h ? spawnOf(h.source) : null;
      return h?.id && spawn && typeof spawn.parent_thread_id === "string" ? [{ file: file.path, header: h, spawn, id: h.id, parent: spawn.parent_thread_id }] : [];
    });
    const family = new Set([root]);
    const found: typeof children = [];
    for (let grew = true; grew; ) {
      grew = false;
      for (const child of children) {
        if (family.has(child.parent) && !family.has(child.id)) {
          family.add(child.id);
          found.push(child);
          grew = true;
        }
      }
    }
    return found.map(({ file, header: h, spawn, id }): SubagentSource => {
      const agentPath = str(spawn.agent_path) ?? "";
      const name = agentPath.split("/").pop() || "subagent";
      const readsWholeFile = (() => {
        try {
          return statSync(file).size <= TAIL_BYTES;
        } catch {
          return true;
        }
      })();
      return {
        id,
        name,
        kind: str(spawn.agent_nickname) ?? str(spawn.agent_role) ?? null,
        depth: typeof spawn.depth === "number" ? spawn.depth : 1,
        startedAt: h.timestamp,
        transcript: file,
        open: () => new TranscriptReader(file, () => (readsWholeFile ? ownWork(codexParser(), agentPath) : codexParser())),
        status: () => status(file),
        startedBy: (call) => call.name === "spawn_agent" && call.summary === name,
      };
    });
  };

  return {
    id: "codex",
    locate,
    open: (transcript) => new TranscriptReader(transcript, codexParser),
    queued: (transcript) => {
      const thread = codexThreadId(transcript);
      return thread ? codexQueue(queuePath, thread) : [];
    },
    subagents,
  };
}
