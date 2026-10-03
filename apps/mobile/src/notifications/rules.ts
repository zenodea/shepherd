// What's worth a notification, and what it says. No native code here, so it can be tested.
import type { AgentInfo, BlockedPrompt, PromptOption, StatusChange } from "@shepherd/protocol";

/** The same agent going blocked → working → blocked quickly notifies once. */
export const COOLDOWN_MS = 20_000;
/** Android shows up to three action buttons. */
export const MAX_ACTIONS = 3;
const QUESTION_LINES = 2;

export type AgentAlert = { paneId: string; kind: "blocked" | "done"; title: string; body: string };
export type AlertAction = Pick<PromptOption, "key" | "label">;
/** How long the excerpt of a finished agent's last reply can be. */
const EXCERPT_CHARS = 180;

export function agentLabel(agent: AgentInfo | null, paneId: string): string {
  return agent?.name || agent?.display_agent || agent?.agent || paneId;
}

/** "claude needs input" when an agent asks something, "claude finished" when it's done working. */
export function alertFor(change: StatusChange, hostName: string): AgentAlert | null {
  if (change.previous === change.status) return null;
  if (change.status !== "blocked" && change.status !== "done") return null;
  // Finished: after working, or after a question (answered somewhere, then it carried on and finished).
  if (change.status === "done" && change.previous !== "working" && change.previous !== "blocked") return null;
  const agent = change.agent;
  const detail = agent?.terminal_title_stripped || agent?.title || agent?.cwd?.split("/").filter(Boolean).pop() || change.paneId;
  const verb = change.status === "blocked" ? "needs input" : "finished";
  return { paneId: change.paneId, kind: change.status, title: `${agentLabel(agent, change.paneId)} ${verb}`, body: `${detail} · ${hostName}` };
}

/**
 * Put the question in the body and its answers on buttons. An answer you
 * write yourself ("Type something.") becomes the Reply box instead, which
 * takes one of Android's three action slots.
 */
export function withPrompt(alert: AgentAlert, prompt: BlockedPrompt | null): { alert: AgentAlert; actions: AlertAction[]; write: AlertAction | null } {
  if (!prompt || prompt.options.length === 0) return { alert, actions: [], write: null };
  const question = questionText(prompt);
  const writeOption = prompt.options.find((o) => o.input) ?? null;
  const buttons = prompt.options.filter((o) => !o.input).slice(0, writeOption ? MAX_ACTIONS - 1 : MAX_ACTIONS);
  return {
    alert: question ? { ...alert, body: `${question}\n${alert.body}` } : alert,
    actions: buttons.map(({ key, label }) => ({ key, label })),
    write: writeOption ? { key: writeOption.key, label: writeOption.label } : null,
  };
}

/** Interface around a question: Claude's tab bar ("← ☐ Database ✔ Submit →"), tool output, bullets. */
const CHROME = /^(?:[⎿└⏺●•│←→]|.*[☐☑☒]|.*✔ Submit)/;

/** The question itself: the last lines before the answers, without interface around them. */
export function questionText(prompt: BlockedPrompt): string {
  return prompt.lines
    .map((l) => l.trim())
    .filter((l) => l && !CHROME.test(l))
    .slice(-QUESTION_LINES)
    .join("\n");
}

/** The opening of an agent's reply, as plain text for a notification. */
export function excerpt(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= EXCERPT_CHARS) return text;
  const cut = text.slice(0, EXCERPT_CHARS);
  const sentence = cut.lastIndexOf(". ");
  return sentence > EXCERPT_CHARS / 2 ? cut.slice(0, sentence + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/** A button answers only if the agent is still asking the same thing: same key, same words. */
export function stillOffered(prompt: BlockedPrompt | null, action: AlertAction): boolean {
  return Boolean(prompt?.options.some((o) => o.key === action.key && o.label === action.label));
}

export class Cooldown {
  private last = new Map<string, number>();
  private readonly ms: number;
  private readonly now: () => number;

  constructor(ms = COOLDOWN_MS, now: () => number = Date.now) {
    this.ms = ms;
    this.now = now;
  }

  /** True (and remembered) unless the same key fired within the cooldown. */
  allow(key: string): boolean {
    const t = this.now();
    if (t - (this.last.get(key) ?? -Infinity) < this.ms) return false;
    this.last.set(key, t);
    return true;
  }
}

/**
 * Status changes missed while the connection was down: the host only sends
 * changes as they happen, so compare what was last seen with the snapshot it
 * sends on reconnecting.
 */
export function missedChanges(before: Map<string, AgentInfo>, after: AgentInfo[]): StatusChange[] {
  const changes: StatusChange[] = [];
  for (const agent of after) {
    const previous = before.get(agent.pane_id);
    if (previous && previous.agent_status !== agent.agent_status) {
      changes.push({ type: "agent.status", paneId: agent.pane_id, status: agent.agent_status, previous: previous.agent_status, agent });
    }
  }
  return changes;
}
