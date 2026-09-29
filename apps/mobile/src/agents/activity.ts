import type { ActivityEntry } from "@sheperd/protocol";

/** Only these are worth a badge: things you'd want to know about. */
export const NOTEWORTHY: ActivityEntry["event"][] = ["blocked", "done"];

export function entryVerb(entry: ActivityEntry): string {
  switch (entry.event) {
    case "blocked":
      return "needs input";
    case "done":
      return "finished";
    case "working":
      return entry.previous === "blocked" ? "got your answer" : "started working";
    case "idle":
      return entry.previous === "working" ? "stopped" : "is idle";
    case "started":
      return "started";
    case "closed":
      return "closed";
    default:
      return entry.event;
  }
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * How long each entry's state lasted or took, keyed by entry id: how long it
 * waited for you (a blocked entry, until its next change) and how long it
 * worked (a finish, since it started working). `entries` are newest first.
 */
export function durations(entries: ActivityEntry[]): Map<number, string> {
  const out = new Map<number, string>();
  const newer = new Map<string, ActivityEntry>();
  for (const entry of entries) {
    const next = newer.get(entry.paneId);
    if (entry.event === "blocked") {
      out.set(entry.id, next ? `waited ${formatDuration(next.at - entry.at)}` : "waiting");
    }
    if (next && (next.event === "done" || (next.event === "idle" && next.previous === "working")) && entry.event === "working") {
      out.set(next.id, `after ${formatDuration(next.at - entry.at)}`);
    }
    newer.set(entry.paneId, entry);
  }
  return out;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayLabel(at: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export function timeLabel(at: number, now = Date.now()): string {
  const ago = now - at;
  if (ago < 60_000) return "now";
  if (ago < 60 * 60_000) return `${Math.floor(ago / 60_000)}m ago`;
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Newest-first entries split into days. */
export function groupByDay(entries: ActivityEntry[], now = Date.now()): { day: string; entries: ActivityEntry[] }[] {
  const groups: { day: string; entries: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const day = dayLabel(entry.at, now);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }
  return groups;
}

/** "2 finished · 1 needed input" for entries after `sinceId`. */
export function awaySummary(entries: ActivityEntry[], sinceId: number): string | null {
  const recent = entries.filter((e) => e.id > sinceId);
  const finished = recent.filter((e) => e.event === "done").length;
  const blocked = recent.filter((e) => e.event === "blocked").length;
  const started = recent.filter((e) => e.event === "started").length;
  const parts: string[] = [];
  if (finished) parts.push(`${finished} finished`);
  if (blocked) parts.push(`${blocked} needed input`);
  if (started) parts.push(`${started} started`);
  return parts.length ? parts.join(" · ") : null;
}
