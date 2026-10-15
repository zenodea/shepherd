// Agents in a linked git worktree are listed under an agent in the main checkout of the same
// repo, the way subagents are under their agent, so a pack of workers doesn't fill the list.
import type { AgentInfo } from "@shepherd/protocol";

/** The agents in worktrees of the repo `agent` works in; none when it's in a worktree itself. */
export function worktreesOf(agent: AgentInfo, agents: AgentInfo[]): AgentInfo[] {
  const repo = agent.git && !agent.git.worktree ? agent.git.repo : null;
  return repo ? agents.filter((a) => a.git?.worktree && a.git.repo === repo) : [];
}

/** Worktree agents listed under an agent in their main checkout instead of on their own. Ones without such an agent stay listed. */
export function foldedWorktrees(agents: AgentInfo[]): Set<string> {
  const mainRepos = new Set(agents.flatMap((a) => (a.git && !a.git.worktree ? [a.git.repo] : [])));
  return new Set(agents.filter((a) => a.git?.worktree && mainRepos.has(a.git.repo)).map((a) => a.pane_id));
}

/** For the badge on an agent's row: its worktrees still working, while it isn't itself. */
export function worktreesRunning(agent: AgentInfo, agents: AgentInfo[]): number {
  return agent.agent_status === "working" ? 0 : worktreesOf(agent, agents).filter((a) => a.agent_status === "working").length;
}

/** The pill under an agent's name: "2 worktrees running", or "3 worktrees". */
export function worktreesPill(worktrees: AgentInfo[]): string | null {
  if (!worktrees.length) return null;
  const running = worktrees.filter((a) => a.agent_status === "working").length;
  if (running) return `${running} worktree${running === 1 ? "" : "s"} running`;
  return `${worktrees.length} worktree${worktrees.length === 1 ? "" : "s"}`;
}
