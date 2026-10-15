// A first message for an agent taking over another's work, on this computer or
// another: where the code is, what was asked, and where the conversation got to.
import type { AgentInfo, ConversationEntry, HandoffRepo, HandoffResult } from "@shepherd/protocol";
import { gitState } from "./changes/git-changes.ts";
import type { Conversations } from "./conversation/conversations.ts";

/** Well under the launcher's 20,000, so there's room to add to it on the phone. */
const BRIEF_BUDGET = 12_000;
const TASK_LIMIT = 2_000;
const MESSAGE_LIMIT = 1_500;
const TOOL_LIMIT = 120;

export type BriefInput = { from: string; agent: string | null; cwd: string | null; repo: HandoffRepo | null; entries: ConversationEntry[] };

export async function handoff(agent: AgentInfo | null, from: string, conversations: Conversations | undefined): Promise<HandoffResult> {
  if (!agent) return { available: false, reason: "That agent isn't running any more." };
  const cwd = agent.cwd || agent.foreground_cwd || null;
  const repo = cwd ? await gitState(cwd) : null;
  const conversation = conversations?.get(agent, { paneId: agent.pane_id, limit: 500 });
  const entries = conversation?.available ? conversation.entries : [];
  const kind = (conversation?.available ? conversation.agent : null) ?? agent.agent ?? null;
  return { available: true, from, agent: kind, cwd, repo, brief: handoffBrief({ from, agent: kind, cwd, repo, entries }) };
}

export function handoffBrief({ from, agent, cwd, repo, entries }: BriefInput): string {
  const who = agent ? `another ${agent} agent` : "another agent";
  const parts = [`I'm handing you work that ${who} was doing on my computer "${from}". Pick it up from where it stopped.`];

  const code = [`## The code`];
  if (cwd) code.push(`- Its folder on ${from}: ${cwd}`);
  if (repo) {
    code.push(`- Repository: ${repo.name}${repo.remote ? ` (${repo.remote})` : ""}`);
    code.push(`- ${repo.branch ? `Branch ${repo.branch}` : "Detached HEAD"}, at ${repo.commit} "${repo.subject}"`);
    if (repo.unpushed) code.push(`- ${plural(repo.unpushed, "commit")} not pushed, so only on ${from}.`);
    if (repo.uncommitted.count > 0) {
      const more = repo.uncommitted.count - repo.uncommitted.files.length;
      code.push(`- Not committed on ${from}, so not here: ${repo.uncommitted.files.join(", ")}${more > 0 ? ` and ${more} more` : ""}.`);
    }
    code.push("", `Before you start, check this folder is that repository on ${repo.branch ?? repo.commit}, at ${repo.commit} or later (fetch first). If it isn't, tell me before changing anything.`);
  } else if (!cwd) {
    code.push("- Not known.");
  }
  parts.push(code.join("\n"));

  const task = entries.find((e) => e.kind === "user");
  if (task && task.kind === "user") parts.push(`## What was asked first\n${quote(clip(task.text, TASK_LIMIT))}`);

  const recent = recentLines(entries.filter((e) => e !== task), BRIEF_BUDGET - parts.join("\n\n").length);
  if (recent.length) parts.push(`## Where it got to (latest last)\n${recent.join("\n")}`);
  return parts.join("\n\n");
}

/** The newest entries that fit in `budget` characters, oldest first. */
function recentLines(entries: ConversationEntry[], budget: number): string[] {
  const lines: string[] = [];
  let used = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const line = render(entries[i]!);
    if (!line) continue;
    if (used + line.length + 1 > budget) break;
    used += line.length + 1;
    lines.unshift(line);
  }
  return lines;
}

function render(entry: ConversationEntry): string | null {
  switch (entry.kind) {
    case "user":
      return `**Me:** ${clip(entry.text, MESSAGE_LIMIT)}`;
    case "assistant":
      return `**Agent:** ${clip(entry.text, MESSAGE_LIMIT)}`;
    case "tool":
      return `- ${entry.name}: ${clip(entry.summary.replace(/\s+/g, " "), TOOL_LIMIT)}`;
    case "notice":
      return `(${entry.text})`;
    default:
      return null;
  }
}

const clip = (text: string, limit: number) => {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
};
const quote = (text: string) => text.replace(/^/gm, "> ");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
