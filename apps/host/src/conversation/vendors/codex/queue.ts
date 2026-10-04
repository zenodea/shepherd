// Codex keeps the messages you queue while it works in a SQLite database
// (~/.codex/queue_1.sqlite), one row per message per thread. Read it, never
// write: the queue is Codex's.
import type { QueuedMessage } from "@shepherd/protocol";
import { clip, isRecord } from "../../entries.ts";
import { json, query } from "../../sqlite.ts";

/** The thread id at the end of a rollout file's name: rollout-<time>-<thread id>.jsonl */
export function codexThreadId(rolloutPath: string): string | null {
  return /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(rolloutPath)?.[1] ?? null;
}

/**
 * The words of a queued message, from whatever shape Codex gives it: every
 * `text` in it, in order, and "[image]" for images.
 */
export function queuedText(payload: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!isRecord(value)) return;
    if (typeof value.type === "string" && value.type.toLowerCase().includes("image")) return void parts.push("[image]");
    for (const [key, child] of Object.entries(value)) {
      if (key === "text" && typeof child === "string") parts.push(child);
      else if (typeof child === "object") walk(child);
    }
  };
  walk(payload);
  return parts.join("\n").trim();
}

/** The messages queued on a thread; none when the database is missing, locked or shaped differently. */
export function codexQueue(path: string, threadId: string): QueuedMessage[] {
  const rows = query<{ payload_json: string; created_at_ms: number }>(
    path,
    "SELECT payload_json, created_at_ms FROM queued_items WHERE thread_id = ? ORDER BY queue_order",
    threadId,
  );
  return rows.flatMap((row) => {
    const text = queuedText(json(row.payload_json));
    return text ? [{ text: clip(text, 2_000), at: new Date(row.created_at_ms).toISOString() }] : [];
  });
}
