// Codex keeps the messages you queue while it works in a SQLite database
// (~/.codex/queue_1.sqlite), one row per message per thread. Read it, never
// write: the queue is Codex's.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { QueuedMessage } from "@shepherd/protocol";
import { clip, isRecord } from "./entries.ts";

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

export class CodexQueue {
  private readonly path: string;
  private db: DatabaseSync | null = null;

  constructor(path: string) {
    this.path = path;
  }

  read(threadId: string): QueuedMessage[] {
    try {
      if (!this.db) {
        if (!existsSync(this.path)) return [];
        this.db = new DatabaseSync(this.path, { readOnly: true });
      }
      const rows = this.db
        .prepare("SELECT payload_json, created_at_ms FROM queued_items WHERE thread_id = ? ORDER BY queue_order")
        .all(threadId) as { payload_json: string; created_at_ms: number }[];
      return rows.flatMap((row) => {
        let payload: unknown;
        try {
          payload = JSON.parse(row.payload_json);
        } catch {
          return [];
        }
        const text = queuedText(payload);
        return text ? [{ text: clip(text, 2_000), at: new Date(row.created_at_ms).toISOString() }] : [];
      });
    } catch {
      // Locked, mid-migration or a different schema: no queue rather than an error.
      this.close();
      return [];
    }
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      // already closed
    }
    this.db = null;
  }
}
