// Handing an agent's work to a new agent, on the same computer or another one.
import type { HandoffResult, Project } from "@shepherd/protocol";

type Handoff = Extract<HandoffResult, { available: true }>;

const lastPart = (path: string | null) => path?.replace(/\/+$/, "").split("/").pop() ?? null;

/** The project on the other computer that holds the same code: the same repository, else a folder with the same name. */
export function matchingProject(projects: Project[], handoff: Handoff): Project | null {
  const names = [handoff.repo?.name, lastPart(handoff.cwd)].filter((n): n is string => !!n);
  for (const name of names) {
    const match = projects.find((p) => p.repoName === name) ?? projects.find((p) => lastPart(p.cwd) === name);
    if (match) return match;
  }
  return null;
}

/** Where to hand off to unless you pick: the first other computer that's online, else the same one. */
export function defaultTarget(computers: { id: string; online: boolean }[], from: string): string {
  return computers.find((c) => c.id !== from && c.online)?.id ?? from;
}

/** What stays behind on the computer it came from, or null when nothing does. */
export function leftBehind(handoff: Handoff): string | null {
  const repo = handoff.repo;
  if (!repo) return null;
  const parts = [
    repo.uncommitted.count > 0 ? `${repo.uncommitted.count} uncommitted file${repo.uncommitted.count === 1 ? "" : "s"}` : null,
    repo.unpushed ? `${repo.unpushed} unpushed commit${repo.unpushed === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return `Only on ${handoff.from}: ${parts.join(" and ")}. Commit and push first if the other computer needs them.`;
}
