// What's worth a notification, and what it says. No native code here, so it can be tested.
import type { AgentInfo, BlockedPrompt, PromptOption, StatusChange } from "@shepherd/protocol";

/** The same agent going blocked → working → blocked quickly notifies once. */
export const COOLDOWN_MS = 20_000;
/** Android shows up to three action buttons. */
export const MAX_ACTIONS = 3;
const QUESTION_LINES = 2;

export type AgentAlert = { paneId: string; kind: "blocked" | "done"; title: string; body: string };
export type AlertAction = Pick<PromptOption, "key" | "label">;

export function agentLabel(agent: AgentInfo | null, paneId: string): string {
  return agent?.name || agent?.display_agent || agent?.agent || paneId;
}

/** "claude needs input" when an agent asks something, "claude finished" when it's done working. */
export function alertFor(change: StatusChange, hostName: string): AgentAlert | null {
  if (change.previous === change.status) return null;
  if (change.status !== "blocked" && change.status !== "done") return null;
  if (change.status === "done" && change.previous !== "working") return null;
  const agent = change.agent;
  const detail = agent?.terminal_title_stripped || agent?.title || agent?.cwd?.split("/").filter(Boolean).pop() || change.paneId;
  const verb = change.status === "blocked" ? "needs input" : "finished";
  return { paneId: change.paneId, kind: change.status, title: `${agentLabel(agent, change.paneId)} ${verb}`, body: `${detail} · ${hostName}` };
}

/** Put the question in the body and its first answers on buttons. */
export function withPrompt(alert: AgentAlert, prompt: BlockedPrompt | null): { alert: AgentAlert; actions: AlertAction[] } {
  if (!prompt || prompt.options.length === 0) return { alert, actions: [] };
  const question = prompt.lines.slice(-QUESTION_LINES).join("\n").trim();
  return {
    alert: question ? { ...alert, body: `${question}\n${alert.body}` } : alert,
    actions: prompt.options.slice(0, MAX_ACTIONS).map(({ key, label }) => ({ key, label })),
  };
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
