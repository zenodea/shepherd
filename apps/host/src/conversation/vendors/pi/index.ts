import { dirname, join } from "node:path";
import type { AgentInfo, SubagentStatus } from "@shepherd/protocol";
import { contentText, isRecord, str } from "../../entries.ts";
import { cwdsOf, firstRecord, headRecords, jsonlFiles, lastRecords, modifiedAt } from "../../files.ts";
import { TranscriptReader } from "../../reader.ts";
import { STALE_MS, type SubagentSource, type Vendor } from "../../vendor.ts";
import { piParser, piSessionDir } from "./parser.ts";

// Subagents (the pi-subagents extension) are sessions of their own beside the
// parent's, with `parentSession` in their header and a session_info name of
// "<type>#<first 8 characters of the agent id>", the id the Agent tool reports.

type About = { task: string; kind: string | null; agentId: string | null };
const abouts = new Map<string, About>();

/** What a subagent was asked and its type, from the start of its session; cached once its task is written. */
function about(path: string): About {
  const cached = abouts.get(path);
  if (cached) return cached;
  const head = headRecords(path, 16);
  const named = /^(.+)#([0-9a-f]{8})$/.exec(str(head.find((r) => r.type === "session_info")?.name) ?? "");
  const asked = head.find((r) => r.type === "message" && isRecord(r.message) && r.message.role === "user");
  const task = asked && isRecord(asked.message) ? contentText(asked.message.content).trim().split("\n")[0]!.replace(/^Task:\s*/i, "") : "";
  const found = { task: task.slice(0, 100) || "Subagent", kind: named?.[1] ?? null, agentId: named?.[2] ?? null };
  if (task) {
    if (abouts.size > 2000) abouts.clear();
    abouts.set(path, found);
  }
  return found;
}

function status(path: string): SubagentStatus {
  const last = lastRecords(path).find((r) => r.type === "message" && isRecord(r.message));
  if (last && isRecord(last.message) && last.message.role === "assistant" && last.message.stopReason === "stop") return "done";
  return Date.now() - (modifiedAt(path) ?? 0) > STALE_MS ? "stopped" : "running";
}

function subagents(transcript: string): SubagentSource[] {
  // A subagent can't be older than the session that started it.
  const since = Date.parse(str(firstRecord(transcript)?.timestamp) ?? "") || 0;
  return jsonlFiles(dirname(transcript)).flatMap((file): SubagentSource[] => {
    if (file.mtimeMs < since) return [];
    const header = firstRecord(file.path);
    const id = str(header?.id);
    if (!id || header?.parentSession !== transcript) return [];
    const { task, kind, agentId } = about(file.path);
    return [
      {
        id,
        name: task,
        kind,
        depth: 1,
        startedAt: str(header.timestamp) ?? null,
        transcript: file.path,
        open: () => new TranscriptReader(file.path, piParser),
        status: () => status(file.path),
        // The Agent call that started it reports its id; one that resumed it names it.
        startedBy: (call, output) => agentId !== null && call.name === "Agent" && `${call.input ?? ""}\n${output ?? ""}`.includes(agentId),
      },
    ];
  });
}

export function pi({ home }: { home: string }): Vendor {
  const sessions = join(home, "sessions");
  const locate = (agent: AgentInfo): string | null => {
    for (const cwd of cwdsOf(agent)) {
      const main = jsonlFiles(join(sessions, piSessionDir(cwd))).find((f) => !firstRecord(f.path)?.parentSession);
      if (main) return main.path;
    }
    return null;
  };
  return { id: "pi", locate, open: (transcript) => new TranscriptReader(transcript, piParser), subagents };
}
