// Hermes Agent: SQLite at <HERMES_HOME>/state.db, one per profile
// (profiles/<name>/state.db). Messages are OpenAI-style chat messages, one
// row each; subagents are sessions with a parent_session_id.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentInfo, FileDiff, SubagentStatus } from "@shepherd/protocol";
import { addedFile, lineDiff, parseUnifiedDiff } from "../../../changes/diff.ts";
import { clip, clipOutput, isRecord, str, toolCall } from "../../entries.ts";
import { cwdsOf } from "../../files.ts";
import { paneOfProcess } from "../../panes.ts";
import { SnapshotReader, type KeyedDraft } from "../../snapshot.ts";
import { json, query } from "../../sqlite.ts";
import { STALE_MS, fromDatabase, inDatabase, type SubagentSource, type Vendor } from "../../vendor.ts";

type Message = {
  id: number;
  role: string;
  content: string | null;
  tool_call_id: string | null;
  tool_calls: string | null;
  tool_name: string | null;
  reasoning: string | null;
  timestamp: number | null;
};

const JSON_PREFIX = "\u0000json:";

function text(content: string | null): string {
  if (!content) return "";
  if (!content.startsWith(JSON_PREFIX)) return content;
  const value = json(content.slice(JSON_PREFIX.length));
  if (Array.isArray(value)) return value.map((p) => (isRecord(p) && typeof p.text === "string" ? p.text : "")).filter(Boolean).join("\n");
  return typeof value === "string" ? value : "";
}

function editDiff(name: string, args: Record<string, unknown>): FileDiff | undefined {
  const path = str(args.path) ?? "";
  if (name === "patch" && typeof args.old_string === "string" && typeof args.new_string === "string") return lineDiff(path, args.old_string, args.new_string);
  if (name === "patch" && typeof args.patch === "string") return parseUnifiedDiff(args.patch, path)[0];
  if (name === "write_file" && typeof args.content === "string") return addedFile(path, args.content);
  return undefined;
}

function result(content: string | null): { ok: boolean; output: string } {
  const value = json(content);
  if (!isRecord(value)) return { ok: true, output: text(content) };
  const failed = (value.error !== undefined && value.error !== null && value.error !== "") || value.success === false || (typeof value.exit_code === "number" && value.exit_code !== 0);
  const output = str(value.output) ?? str(value.diff) ?? str(value.error) ?? JSON.stringify(value, null, 2);
  return { ok: !failed, output };
}

function drafts(rows: Message[]): KeyedDraft[] {
  return rows.flatMap((m): KeyedDraft[] => {
    const at = typeof m.timestamp === "number" ? new Date(m.timestamp * 1000).toISOString() : undefined;
    const stamp = at ? { at } : {};
    if (m.role === "user") {
      const body = text(m.content).trim();
      return body ? [{ key: `m${m.id}`, kind: "user", text: clip(body), ...stamp }] : [];
    }
    if (m.role === "tool") {
      const { ok, output } = result(m.content);
      return [{ key: `m${m.id}`, kind: "tool_result", callId: m.tool_call_id ?? `m${m.id}`, ok, output: clipOutput(output), ...stamp }];
    }
    if (m.role !== "assistant") return [];
    const out: KeyedDraft[] = [];
    if (m.reasoning?.trim()) out.push({ key: `m${m.id}:thinking`, kind: "thinking", text: clip(m.reasoning.trim()), ...stamp });
    const body = text(m.content).trim();
    if (body) out.push({ key: `m${m.id}`, kind: "assistant", text: clip(body), ...stamp });
    const calls = json(m.tool_calls);
    for (const call of Array.isArray(calls) ? calls.filter(isRecord) : []) {
      const fn = isRecord(call.function) ? call.function : {};
      const name = str(fn.name) ?? "tool";
      const args = json(fn.arguments);
      const input = isRecord(args) ? args : {};
      const callId = str(call.id) ?? str(call.call_id) ?? `m${m.id}`;
      out.push({ key: `c${callId}`, ...toolCall(callId, name, input, at, editDiff(name, input)) });
    }
    return out;
  });
}

const MESSAGES = "SELECT id, role, content, tool_call_id, tool_calls, tool_name, reasoning, timestamp FROM messages WHERE session_id = ?";

export function hermes({ home }: { home: string }): Vendor {
  const databases = () => {
    const profiles = (() => {
      try {
        return readdirSync(join(home, "profiles")).map((name) => join(home, "profiles", name, "state.db"));
      } catch {
        return [];
      }
    })();
    return [join(home, "state.db"), ...profiles];
  };

  const open = (transcript: string) =>
    new SnapshotReader({
      version: () => {
        const { path, session } = fromDatabase(transcript);
        const [row] = query<{ n: number; last: number }>(path, "SELECT COUNT(*) AS n, MAX(id) AS last FROM messages WHERE session_id = ? AND active = 1", session);
        return `${row?.n}:${row?.last}`;
      },
      load: () => {
        const { path, session } = fromDatabase(transcript);
        // Hidden rows are the agent's own bookkeeping; compacted ones were summarised away.
        let rows = query<Message>(path, `${MESSAGES} AND active = 1 AND (display_kind IS NULL OR display_kind != 'hidden') ORDER BY id`, session);
        if (rows.length === 0) rows = query<Message>(path, `${MESSAGES} ORDER BY id`, session);
        return { drafts: drafts(rows) };
      },
    });

  const locate = (agent: AgentInfo): string | null => {
    const cwds = cwdsOf(agent);
    for (const path of databases()) {
      // During a turn, the session holds a lease naming the process that runs it.
      for (const lease of query<{ conversation_id: string; holder: string }>(path, "SELECT conversation_id, holder FROM session_turn_leases")) {
        const pid = Number(/pid=(\d+)/.exec(lease.holder)?.[1]);
        if (pid && paneOfProcess(pid) === agent.pane_id) return inDatabase(path, lease.conversation_id);
      }
      for (const cwd of cwds) {
        const [row] = query<{ id: string }>(
          path,
          "SELECT id FROM sessions WHERE (cwd = ? OR git_repo_root = ?) AND parent_session_id IS NULL AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
          cwd,
          cwd,
        );
        if (row) return inDatabase(path, row.id);
      }
    }
    return null;
  };

  const subagents = (transcript: string): SubagentSource[] => {
    const { path, session } = fromDatabase(transcript);
    const found: SubagentSource[] = [];
    const visit = (parent: string, depth: number) => {
      const children = query<{ id: string; started_at: number; ended_at: number | null; last_activity_at: number | null }>(
        path,
        "SELECT id, started_at, ended_at, last_activity_at FROM sessions WHERE parent_session_id = ? AND source = 'subagent' ORDER BY started_at",
        parent,
      );
      for (const child of children) {
        const [task] = query<{ content: string | null }>(path, "SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id LIMIT 1", child.id);
        const childTranscript = inDatabase(path, child.id);
        found.push({
          id: child.id,
          name: (text(task?.content ?? null).split("\n")[0] ?? "").slice(0, 80) || "Subagent",
          kind: null,
          depth,
          startedAt: child.started_at ? new Date(child.started_at * 1000).toISOString() : null,
          transcript: childTranscript,
          open: () => open(childTranscript),
          status: (): SubagentStatus => {
            const [now] = query<{ ended_at: number | null; last_activity_at: number | null }>(path, "SELECT ended_at, last_activity_at FROM sessions WHERE id = ?", child.id);
            if (now?.ended_at) return "done";
            const last = (now?.last_activity_at ?? child.started_at) * 1000;
            return Date.now() - last > STALE_MS ? "stopped" : "running";
          },
          startedBy: () => false,
        });
        visit(child.id, depth + 1);
      }
    };
    visit(session, 1);
    return found;
  };

  return { id: "hermes", locate, open, subagents };
}
