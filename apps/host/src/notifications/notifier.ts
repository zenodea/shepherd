import type { AgentInfo, AgentStatus, BlockedPrompt, StatusChange } from "@shepherd/protocol";
import type { AgentTracker } from "../herdr/agent-tracker.ts";
import type { ActionOutcome, NotificationActions, NtfyAction } from "./actions.ts";

export type NotifyConfig = {
  /** ntfy server, e.g. https://ntfy.sh */
  server: string;
  /** Random topic name; anyone who knows it can read the notifications. */
  topic: string;
  /** Answer buttons on "needs input" notifications (default on). */
  actions?: boolean;
};

export type NtfyMessage = {
  topic: string;
  title: string;
  message: string;
  priority: number;
  tags: string[];
  click: string;
  actions?: NtfyAction[];
};

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

const COOLDOWN_MS = 20_000;
/** Let the agent finish drawing its prompt before reading it. */
const PROMPT_SETTLE_MS = 700;
const QUESTION_LINES = 2;

const FAILURE_TEXT: Partial<Record<Extract<ActionOutcome, { ok: false }>["reason"], string>> = {
  changed: "It's asking something else now. Open Shepherd to answer.",
  not_blocked: "It isn't waiting for an answer any more.",
  expired: "That button expired. Open Shepherd to answer.",
  failed: "Sending the answer failed. Open Shepherd to answer.",
};

export function ntfyBase(server: string): string {
  return server.replace(/\/+$/, "");
}

/** Link that opens the ntfy Android app and subscribes to the topic. */
export function ntfySubscribeUrl({ server, topic }: NotifyConfig): string {
  const url = new URL(ntfyBase(server));
  const secure = url.protocol === "https:" ? "" : "&secure=false";
  return `ntfy://${url.host}${url.pathname.replace(/\/$/, "")}/${topic}?display=Shepherd${secure}`;
}

export function agentLabel(agent: AgentInfo | null, paneId: string): string {
  return agent?.name || agent?.display_agent || agent?.agent || paneId;
}

/**
 * Which transitions are worth a notification, and how loudly. `hostId` (the
 * start of the host's public key, as the app stores it) makes the link open on
 * this computer when the phone is paired with several.
 */
export function notificationFor(change: StatusChange, hostName: string, topic: string, hostId?: string): NtfyMessage | null {
  const important: Partial<Record<AgentStatus, { verb: string; priority: number; tag: string }>> = {
    blocked: { verb: "needs input", priority: 4, tag: "raising_hand" },
    done: { verb: "finished", priority: 3, tag: "white_check_mark" },
  };
  const kind = important[change.status];
  if (!kind || change.previous === change.status) return null;
  if (change.status === "done" && change.previous !== "working") return null;

  const agent = change.agent;
  const detail = agent?.terminal_title_stripped || agent?.title || agent?.cwd?.split("/").filter(Boolean).pop() || change.paneId;
  return {
    topic,
    title: `${agentLabel(agent, change.paneId)} ${kind.verb}`,
    message: `${detail} · ${hostName}`,
    priority: kind.priority,
    tags: [kind.tag],
    click: `shepherd://agent/${encodeURIComponent(change.paneId)}${hostId ? `?host=${hostId}` : ""}`,
  };
}

/** Publishes agent status changes to an ntfy topic. */
export class Notifier {
  private lastSent = new Map<string, number>();
  private readonly config: NotifyConfig;
  private readonly hostName: string;
  private readonly hostId: string | undefined;
  private readonly fetchImpl: Fetch;
  private readonly onError: (err: Error) => void;
  private readonly prompts: { read: (paneId: string) => Promise<BlockedPrompt | null>; actions: NotificationActions } | null;
  private readonly onStatus = (change: StatusChange) => void this.handle(change);

  constructor(opts: {
    config: NotifyConfig;
    hostName: string;
    hostId?: string;
    /** With these, "needs input" notifications show the question and answer buttons. */
    prompts?: { read: (paneId: string) => Promise<BlockedPrompt | null>; actions: NotificationActions };
    fetch?: Fetch;
    onError?: (err: Error) => void;
  }) {
    this.config = opts.config;
    this.hostName = opts.hostName;
    this.hostId = opts.hostId;
    this.prompts = opts.prompts ?? null;
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as Fetch);
    this.onError = opts.onError ?? (() => {});
  }

  attach(tracker: AgentTracker): () => void {
    tracker.on("status", this.onStatus);
    return () => tracker.off("status", this.onStatus);
  }

  async handle(change: StatusChange): Promise<void> {
    const message = notificationFor(change, this.hostName, this.config.topic, this.hostId);
    if (!message) return;
    const key = `${change.paneId}:${change.status}`;
    const now = Date.now();
    if (now - (this.lastSent.get(key) ?? 0) < COOLDOWN_MS) return;
    this.lastSent.set(key, now);
    if (change.status === "blocked" && this.prompts) await this.addPrompt(message, change.paneId);
    await this.publish(message);
  }

  /** Put the question in the body and its options on buttons. */
  private async addPrompt(message: NtfyMessage, paneId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, PROMPT_SETTLE_MS));
    const prompt = await this.prompts!.read(paneId).catch(() => null);
    if (!prompt || prompt.options.length === 0) return;
    const question = prompt.lines.slice(-QUESTION_LINES).join("\n").trim();
    if (question) message.message = `${question}\n${message.message}`;
    message.actions = this.prompts!.actions.buttons(paneId, prompt);
  }

  /** Tell the phone when a button press couldn't be applied. */
  async actionFailed(outcome: ActionOutcome, agent: AgentInfo | null): Promise<void> {
    if (outcome.ok || !outcome.paneId) return;
    const text = FAILURE_TEXT[outcome.reason];
    if (!text) return;
    await this.publish({
      topic: this.config.topic,
      title: `Couldn't answer ${agentLabel(agent, outcome.paneId)}`,
      message: text,
      priority: 3,
      tags: ["warning"],
      click: `shepherd://agent/${encodeURIComponent(outcome.paneId)}${this.hostId ? `?host=${this.hostId}` : ""}`,
    });
  }

  async publish(message: NtfyMessage): Promise<void> {
    try {
      // JSON publishing avoids header encoding limits for non-ASCII titles.
      const res = await this.fetchImpl(ntfyBase(this.config.server), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
      });
      if (!res.ok) throw new Error(`ntfy responded ${res.status}`);
    } catch (err) {
      this.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
