import type { AgentInfo, BlockedOn } from "@shepherd/protocol";

export function agentName(agent: AgentInfo): string {
  return agent.name || agent.display_agent || agent.agent || "agent";
}

export function agentTitle(agent: AgentInfo): string | null {
  return agent.title || agent.terminal_title_stripped || null;
}

const BLOCKED_ON: Record<BlockedOn, string> = { permission: "Needs permission", question: "Has a question", auth: "Needs a password" };

/** What a blocked agent waits for, when its computer says (Rex does); null otherwise. */
export function blockedLabel(agent: AgentInfo): string | null {
  return agent.agent_status === "blocked" && agent.blocked_on ? (BLOCKED_ON[agent.blocked_on] ?? null) : null;
}

/** The line the agent reports about what it's doing, while it's working or waiting (Rex only). */
export function doingNow(agent: AgentInfo): string | null {
  if (agent.agent_status !== "working" && agent.agent_status !== "blocked") return null;
  return agent.status_text?.trim() || null;
}

export function shortPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

/** Project an agent belongs to: the repo for herdr worktrees, else the folder name. */
export function projectOf(agent: AgentInfo): string {
  return projectOfPath(agent.foreground_cwd ?? agent.cwd, agent.workspace_id);
}

export function projectOfPath(path: string | null | undefined, fallback: string): string {
  const worktree = /\/\.herdr\/worktrees\/([^/]+)\//.exec(path ?? "");
  if (worktree) return worktree[1]!;
  return (path ?? "").split("/").filter(Boolean).at(-1) ?? fallback;
}
