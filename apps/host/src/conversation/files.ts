import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentInfo } from "@shepherd/protocol";

export type JsonlFile = { path: string; mtimeMs: number };

/** A folder's .jsonl files, newest first. */
export function jsonlFiles(dir: string): JsonlFile[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const files: JsonlFile[] = [];
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

const HEADER_BYTES = 128 * 1024;
const headers = new Map<string, Record<string, unknown>>();

/** The first record of a file, cached: transcripts start with a header that doesn't change (once it's written). */
export function firstRecord(path: string): Record<string, unknown> | null {
  const cached = headers.get(path);
  if (cached) return cached;
  const [record = null] = readRecords(path, 0, HEADER_BYTES, 1);
  if (headers.size > 2000) headers.clear();
  if (record) headers.set(path, record);
  return record;
}

/** Up to `max` records from the start of a file. */
export function headRecords(path: string, max: number): Record<string, unknown>[] {
  return readRecords(path, 0, HEADER_BYTES, max);
}

/** The last records of a file, newest first, from its final `bytes`. */
export function lastRecords(path: string, bytes = 256 * 1024): Record<string, unknown>[] {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return [];
  }
  const start = Math.max(0, size - bytes);
  return readRecords(path, start, size - start, Infinity, start > 0).reverse();
}

function readRecords(path: string, from: number, length: number, max: number, skipFirst = false): Record<string, unknown>[] {
  let text: string;
  try {
    const fd = openSync(path, "r");
    try {
      const buffer = Buffer.alloc(length);
      text = buffer.subarray(0, readSync(fd, buffer, 0, length, from)).toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }
  const lines = text.split("\n");
  if (skipFirst) lines.shift();
  const records: Record<string, unknown>[] = [];
  for (const line of lines) {
    if (records.length >= max) break;
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === "object" && value !== null && !Array.isArray(value)) records.push(value as Record<string, unknown>);
    } catch {
      // partial or blank line
    }
  }
  return records;
}

export function modifiedAt(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

export function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

/** The folders an agent works in: where it started, and where its shell is now. */
export function cwdsOf(agent: AgentInfo): string[] {
  return [...new Set([agent.cwd, agent.foreground_cwd].filter((c): c is string => typeof c === "string" && c.startsWith("/")))];
}

/** YYYY/MM/DD folders from today back, in local time. */
export function recentDayDirs(root: string, days: number, now = new Date()): string[] {
  const dirs: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    dirs.push(join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")));
  }
  return dirs;
}
