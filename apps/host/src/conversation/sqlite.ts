import { existsSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const open = new Map<string, DatabaseSync>();

/** Rows from an agent's database, read-only. Nothing (rather than an error) when it's missing, locked or shaped differently. */
export function query<T = Record<string, unknown>>(path: string, sql: string, ...params: SQLInputValue[]): T[] {
  try {
    let db = open.get(path);
    if (!db) {
      if (!existsSync(path)) return [];
      db = new DatabaseSync(path, { readOnly: true });
      open.set(path, db);
    }
    return db.prepare(sql).all(...params) as T[];
  } catch {
    open.get(path)?.close();
    open.delete(path);
    return [];
  }
}

export function json(text: unknown): unknown {
  if (typeof text !== "string") return text;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
