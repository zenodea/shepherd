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
