import type { Subagent, SubagentStatus } from "@shepherd/protocol";
import { colors, statusColors } from "../ui/theme";

export const subagentStatusLabel: Record<SubagentStatus, string> = { running: "Running", done: "Done", stopped: "Stopped" };

export const subagentStatusColor = (status: SubagentStatus) =>
  status === "running" ? statusColors.working : status === "done" ? statusColors.done : colors.subtle;

function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "2m" so far while it runs, or "took 4m" once it's done. */
export function subagentTime(subagent: Subagent, now = Date.now()): string | null {
  const start = subagent.startedAt ? Date.parse(subagent.startedAt) : NaN;
  if (Number.isNaN(start)) return null;
  if (subagent.status === "running") return duration(now - start);
  const end = subagent.updatedAt ? Date.parse(subagent.updatedAt) : NaN;
  return Number.isNaN(end) || end < start ? null : `took ${duration(end - start)}`;
}

/** The pill under an agent's name: "2 subagents running", or "3 subagents". */
export function subagentsPill(subagents: Subagent[]): string | null {
  if (!subagents.length) return null;
  const running = subagents.filter((s) => s.status === "running").length;
  if (running) return `${running} subagent${running === 1 ? "" : "s"} running`;
  return `${subagents.length} subagent${subagents.length === 1 ? "" : "s"}`;
}

/** Running first, then newest first. */
export function sortSubagents(subagents: Subagent[]): Subagent[] {
  const rank = (s: Subagent) => (s.status === "running" ? 0 : 1);
  return [...subagents].sort((a, b) => rank(a) - rank(b) || (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}
