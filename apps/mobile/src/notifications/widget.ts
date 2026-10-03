import type { AgentInfo, AgentStatus, BlockedPrompt } from "@shepherd/protocol";
import type { HostState } from "../connection/host-client";
import { notificationId } from "./agent-prompt";
import { agentLabel, questionText } from "./rules";

/** The question of the agent that needs you, with up to two answers to tap. */
export type WidgetAsk = { paneId: string; notificationId: number; url: string; question: string; answers: { key: string; label: string }[] };

/** What the home-screen widget shows; the native widget draws it as is. */
export type WidgetSummary = {
  title: string;
  summary: string;
  /** The most urgent state, for the summary's colour. */
  tone: "blocked" | "working" | "done" | "idle";
  /** `url`: tapping the line opens that agent. */
  lines: { text: string; status: AgentStatus; url: string }[];
  ask?: WidgetAsk;
  /** When this was true, unix ms. */
  at: number;
};

const MAX_ANSWERS = 2;

const agentUrl = (paneId: string, hostId: string | null) => `shepherd://agent/${encodeURIComponent(paneId)}${hostId ? `?host=${hostId}` : ""}`;

/** The agent the widget asks about: the first one that needs you. */
export function askingAgent(state: HostState): AgentInfo | null {
  return state.status === "online" ? (state.agents.find((a) => a.agent_status === "blocked") ?? null) : null;
}

export function widgetAsk(agent: AgentInfo, prompt: BlockedPrompt | null, hostId: string | null): WidgetAsk | null {
  const answers = (prompt?.options ?? []).filter((o) => !o.input).slice(0, MAX_ANSWERS);
  if (!prompt || answers.length === 0) return null;
  return {
    paneId: agent.pane_id,
    notificationId: notificationId(agent.pane_id),
    url: agentUrl(agent.pane_id, hostId),
    question: questionText(prompt) || `${agentLabel(agent, agent.pane_id)} needs you`,
    answers: answers.map(({ key, label }) => ({ key, label })),
  };
}

const ORDER: Record<AgentStatus, number> = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };
const MAX_LINES = 3;

export function widgetSummary(state: HostState, hostName: string | null, hostId: string | null = null, now = Date.now()): WidgetSummary {
  const title = `Shepherd · ${state.host?.name ?? hostName ?? "not paired"}`;
  if (!hostName) return { title: "Shepherd", summary: "Open Shepherd to pair", tone: "idle", lines: [], at: now };
  if (state.status !== "online") return { title, summary: "Not connected", tone: "idle", lines: [], at: now };
  const count = (s: AgentStatus) => state.agents.filter((a) => a.agent_status === s).length;
  const blocked = count("blocked");
  const working = count("working");
  const done = count("done");
  const parts: string[] = [];
  if (blocked) parts.push(`${blocked} need${blocked === 1 ? "s" : ""} you`);
  if (working) parts.push(`${working} working`);
  if (done && !blocked) parts.push(`${done} finished`);
  const tone = blocked ? "blocked" : working ? "working" : done ? "done" : "idle";
  const lines = [...state.agents]
    .filter((a) => a.agent_status !== "idle" && a.agent_status !== "unknown")
    .sort((a, b) => ORDER[a.agent_status] - ORDER[b.agent_status])
    .slice(0, MAX_LINES)
    .map((a) => ({
      text: [agentLabel(a, a.pane_id), a.terminal_title_stripped || a.title || a.cwd?.split("/").pop()].filter(Boolean).join(" · "),
      status: a.agent_status,
      url: agentUrl(a.pane_id, hostId),
    }));
  return { title, summary: parts.join(" · ") || (state.agents.length ? "All quiet" : "No agents running"), tone, lines, at: now };
}
