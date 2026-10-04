// OpenCode: SQLite at <data>/opencode/opencode.db. A session's messages are
// rows of `message`, their text, reasoning and tool calls rows of `part`;
// subagents are child sessions (parent_id).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentInfo, ContextUsage, FileDiff, ImageRef, QueuedMessage, SubagentStatus } from "@shepherd/protocol";
import { addedFile, parseUnifiedDiff } from "../../../changes/diff.ts";
import { real } from "../../../herdr/folders.ts";
import { clip, clipOutput, isRecord, num, str, toolCall } from "../../entries.ts";
import { cwdsOf } from "../../files.ts";
import type { FoundImage } from "../../images.ts";
import { SnapshotReader, type KeyedDraft } from "../../snapshot.ts";
import { json, query } from "../../sqlite.ts";
import { STALE_MS, fromDatabase, inDatabase, type SubagentSource, type Vendor } from "../../vendor.ts";

type Row = { id: string; data: string; time_created?: number };
type Part = Record<string, unknown> & { id: string; message: string };

/** The database: OPENCODE_DB if set, else opencode.db (a source build writes opencode-<channel>.db). */
function databasePath(data: string, named: string | undefined): string | null {
  if (named) return named.startsWith("/") ? named : join(data, named);
  let names: string[];
  try {
    names = readdirSync(data).filter((n) => /^opencode(-[\w.-]+)?\.db$/.test(n));
  } catch {
    return null;
  }
  if (names.includes("opencode.db")) return join(data, "opencode.db");
  const newest = names.map((n) => join(data, n)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return newest ?? null;
}

const iso = (ms: unknown) => (typeof ms === "number" ? new Date(ms).toISOString() : undefined);

function editDiff(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown>): FileDiff | undefined {
  const path = str(input.filePath) ?? "";
  const patch = isRecord(metadata.filediff) ? str(metadata.filediff.patch) : str(metadata.diff);
  if (patch) {
    const diff = parseUnifiedDiff(patch, path)[0];
    if (diff) return { ...diff, path };
  }
  if (tool === "write" && typeof input.content === "string") return addedFile(path, input.content);
  return undefined;
}

function images(parts: Part[]): ImageRef[] {
  return parts.flatMap((p) => {
    const url = str(p.url) ?? "";
    const match = p.type === "file" ? /^data:(image\/[\w.+-]+);base64,/.exec(url) : null;
    return match ? [{ id: p.id, mime: match[1]!, bytes: Math.floor(((url.length - match[0].length) * 3) / 4) }] : [];
  });
}

function messageDrafts(message: Row & Record<string, unknown>, parts: Part[]): KeyedDraft[] {
  const at = iso(isRecord(message.time) ? message.time.created : undefined);
  const stamp = at ? { at } : {};
  if (message.role === "user") {
    const text = parts
      .filter((p) => p.type === "text" && !p.synthetic && !p.ignored)
      .map((p) => str(p.text) ?? "")
      .join("\n")
      .trim();
    const found = images(parts);
    return text || found.length ? [{ key: message.id, kind: "user", text: clip(text || "[image]"), ...stamp, ...(found.length ? { images: found } : {}) }] : [];
  }
  // An entry keeps the version first seen, so each part waits until it's finished.
  const replied = isRecord(message.time) && Boolean(message.time.completed);
  const out: KeyedDraft[] = [];
  for (const p of parts) {
    const time = isRecord(p.time) ? p.time : {};
    const partAt = iso(time.start) ?? at;
    const partStamp = partAt ? { at: partAt } : {};
    const text = (str(p.text) ?? "").trim();
    const written = Boolean(time.end) || replied;
    if (p.type === "reasoning" && text && written) out.push({ key: p.id, kind: "thinking", text: clip(text), ...partStamp });
    if (p.type === "text" && text && written && !p.synthetic) out.push({ key: p.id, kind: "assistant", text: clip(text), ...partStamp });
    if (p.type !== "tool" || !isRecord(p.state)) continue;
    const state = p.state;
    const finished = state.status === "completed" || state.status === "error";
    // A running subagent's `task` call shows at once, so the subagent can be opened from it.
    if (!finished && !(state.status === "running" && p.tool === "task")) continue;
    const callId = str(p.callID) ?? p.id;
    const input = isRecord(state.input) ? state.input : {};
    const metadata = isRecord(state.metadata) ? state.metadata : {};
    const tool = str(p.tool) ?? "tool";
    out.push({ key: p.id, ...toolCall(callId, tool, input, partAt, editDiff(tool, input, metadata)) });
    if (finished) {
      const output = state.status === "error" ? (str(state.error) ?? "") : (str(state.output) ?? "");
      out.push({ key: `${p.id}:result`, kind: "tool_result", callId, ok: state.status === "completed", output: clipOutput(output), ...partStamp });
    }
  }
  return out;
}

/** The models.dev catalogue OpenCode caches: each model's context window. */
function contextWindow(cache: string, provider: string | undefined, model: string | undefined): number | null {
  if (!provider || !model) return null;
  try {
    const catalogue = JSON.parse(readFileSync(join(cache, "models.json"), "utf8")) as Record<string, { models?: Record<string, { limit?: { context?: number } }> }>;
    return catalogue[provider]?.models?.[model]?.limit?.context ?? null;
  } catch {
    return null;
  }
}

export function opencode({ data, cache, db: named }: { data: string; cache: string; db?: string }): Vendor {
  const db = () => databasePath(data, named);

  const conversation = (transcript: string) => {
    const { path, session } = fromDatabase(transcript);
    const messages = query<Row>(path, "SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created, id", session).map(
      (m) => ({ ...(json(m.data) as Record<string, unknown>), id: m.id, time_created: m.time_created }) as Row & Record<string, unknown>,
    );
    const parts = query<{ id: string; message_id: string; data: string }>(path, "SELECT id, message_id, data FROM part WHERE session_id = ? ORDER BY id", session).map(
      (p) => ({ ...(json(p.data) as Record<string, unknown>), id: p.id, message: p.message_id }) as Part,
    );
    return { path, session, messages, parts };
  };

  const open = (transcript: string) =>
    new SnapshotReader({
      version: () => {
        const { path, session } = fromDatabase(transcript);
        const [row] = query<{ n: number; t: number }>(path, "SELECT COUNT(*) AS n, MAX(time_updated) AS t FROM part WHERE session_id = ?", session);
        const [msg] = query<{ t: number }>(path, "SELECT MAX(time_updated) AS t FROM message WHERE session_id = ?", session);
        return `${row?.n}:${row?.t}:${msg?.t}`;
      },
      load: () => {
        const { messages, parts } = conversation(transcript);
        const byMessage = new Map<string, Part[]>();
        for (const p of parts) {
          const list = byMessage.get(p.message);
          if (list) list.push(p);
          else byMessage.set(p.message, [p]);
        }
        // While a reply is being written, messages sent after it wait their turn: queued, not part of the conversation yet.
        const latest = [...messages].reverse().find((m) => m.role === "assistant");
        const busySince = latest && isRecord(latest.time) && !latest.time.completed ? num(latest.time.created) : Infinity;
        const waiting = (m: Record<string, unknown>) => m.role === "user" && isRecord(m.time) && num(m.time.created) > busySince;
        const queued: QueuedMessage[] = messages.filter(waiting).map((m) => ({
          text: clip(
            (byMessage.get(m.id) ?? []).filter((p) => p.type === "text" && !p.synthetic).map((p) => str(p.text) ?? "").join("\n").trim(),
            2_000,
          ),
          ...(isRecord(m.time) && iso(m.time.created) ? { at: iso(m.time.created)! } : {}),
        }));
        const drafts = messages.filter((m) => !waiting(m)).flatMap((m) => messageDrafts(m, byMessage.get(m.id) ?? []));
        const last = [...messages].reverse().find((m) => m.role === "assistant" && isRecord(m.tokens));
        let context: ContextUsage | null = null;
        if (last && isRecord(last.tokens)) {
          const t = last.tokens;
          const used = num(t.input) + num(t.output) + num(t.reasoning) + (isRecord(t.cache) ? num(t.cache.read) + num(t.cache.write) : 0);
          if (used > 0) context = { used, window: contextWindow(cache, str(last.providerID), str(last.modelID)) };
        }
        return { drafts, context, queued };
      },
      image: (id): FoundImage | null => {
        const { path } = fromDatabase(transcript);
        const [row] = query<{ data: string }>(path, "SELECT data FROM part WHERE id = ?", id);
        const url = str((json(row?.data) as Record<string, unknown> | null)?.url) ?? "";
        const match = /^data:(image\/[\w.+-]+);base64,(.*)$/s.exec(url);
        return match ? { mime: match[1]!, data: match[2]! } : null;
      },
    });

  const locate = (agent: AgentInfo): string | null => {
    const path = db();
    if (!path) return null;
    for (const cwd of cwdsOf(agent)) {
      const sql = "SELECT id FROM session WHERE directory = ? AND parent_id IS NULL ORDER BY time_updated DESC, id DESC LIMIT 1";
      const [row] = [...query<{ id: string }>(path, sql, real(cwd)), ...query<{ id: string }>(path, sql, cwd)];
      if (row) return inDatabase(path, row.id);
    }
    return null;
  };

  const subagents = (transcript: string): SubagentSource[] => {
    const { path, session } = fromDatabase(transcript);
    const found: SubagentSource[] = [];
    const visit = (parent: string, depth: number) => {
      const children = query<{ id: string; title: string; time_created: number; time_updated: number }>(
        path,
        "SELECT id, title, time_created, time_updated FROM session WHERE parent_id = ? ORDER BY time_created",
        parent,
      );
      // The `task` call that started each child names it in its metadata.
      const started = new Map<string, string>();
      for (const p of query<{ data: string }>(path, "SELECT data FROM part WHERE session_id = ?", parent)) {
        const part = json(p.data) as Record<string, unknown> | null;
        const state = part && isRecord(part.state) ? part.state : null;
        const child = state && isRecord(state.metadata) ? str(state.metadata.sessionId) : undefined;
        if (part?.tool === "task" && child) started.set(child, str(part.callID) ?? "");
      }
      for (const child of children) {
        const title = /^(.*?)(?: \(@([\w-]+) subagent\))?$/.exec(child.title ?? "")!;
        const childTranscript = inDatabase(path, child.id);
        found.push({
          id: child.id,
          name: title[1] || "Subagent",
          kind: title[2] ?? null,
          depth,
          startedAt: iso(child.time_created) ?? null,
          transcript: childTranscript,
          open: () => open(childTranscript),
          status: (): SubagentStatus => {
            const [last] = query<{ data: string }>(path, "SELECT data FROM message WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT 1", child.id);
            const message = json(last?.data) as Record<string, unknown> | null;
            if (message?.role === "assistant" && isRecord(message.time) && message.time.completed) return "done";
            return Date.now() - child.time_updated > STALE_MS ? "stopped" : "running";
          },
          startedBy: (call) => started.get(child.id) === call.callId,
        });
        visit(child.id, depth + 1);
      }
    };
    visit(session, 1);
    return found;
  };

  return {
    id: "opencode",
    locate,
    open,
    queued: (_transcript, reader) => reader.queued() ?? [],
    subagents,
  };
}
