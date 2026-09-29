import type { AgentInfo } from "@sheperd/protocol";

export function agentName(agent: AgentInfo): string {
  return agent.name || agent.display_agent || agent.agent || "agent";
}

export function agentTitle(agent: AgentInfo): string | null {
  return agent.title || agent.terminal_title_stripped || null;
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
