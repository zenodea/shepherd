import type { AgentInfo, AgentStatus, StatusChange } from "@sheperd/protocol";
import type { AgentTracker } from "./agent-tracker.ts";

export type NotifyConfig = {
  /** ntfy server, e.g. https://ntfy.sh */
  server: string;
  /** Random topic name; anyone who knows it can read the notifications. */
  topic: string;
};

export type NtfyMessage = {
  topic: string;
  title: string;
  message: string;
  priority: number;
  tags: string[];
  click: string;
};

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

const COOLDOWN_MS = 20_000;

export function ntfyBase(server: string): string {
  return server.replace(/\/+$/, "");
}

/** Link that opens the ntfy Android app and subscribes to the topic. */
export function ntfySubscribeUrl({ server, topic }: NotifyConfig): string {
  const url = new URL(ntfyBase(server));
  const secure = url.protocol === "https:" ? "" : "&secure=false";
  return `ntfy://${url.host}${url.pathname.replace(/\/$/, "")}/${topic}?display=sheperd${secure}`;
}

export function agentLabel(agent: AgentInfo | null, paneId: string): string {
  return agent?.name || agent?.display_agent || agent?.agent || paneId;
}

/** Which transitions are worth a notification, and how loudly. */
export function notificationFor(change: StatusChange, hostName: string, topic: string): NtfyMessage | null {
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
    click: `sheperd://agent/${encodeURIComponent(change.paneId)}`,
  };
}

/** Publishes agent status changes to an ntfy topic. */
export class Notifier {
  private lastSent = new Map<string, number>();
  private readonly config: NotifyConfig;
  private readonly hostName: string;
  private readonly fetchImpl: Fetch;
  private readonly onError: (err: Error) => void;
  private readonly onStatus = (change: StatusChange) => void this.handle(change);

  constructor(opts: { config: NotifyConfig; hostName: string; fetch?: Fetch; onError?: (err: Error) => void }) {
    this.config = opts.config;
    this.hostName = opts.hostName;
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as Fetch);
    this.onError = opts.onError ?? (() => {});
  }

  attach(tracker: AgentTracker): () => void {
    tracker.on("status", this.onStatus);
    return () => tracker.off("status", this.onStatus);
  }

  async handle(change: StatusChange): Promise<void> {
    const message = notificationFor(change, this.hostName, this.config.topic);
    if (!message) return;
    const key = `${change.paneId}:${change.status}`;
    const now = Date.now();
    if (now - (this.lastSent.get(key) ?? 0) < COOLDOWN_MS) return;
    this.lastSent.set(key, now);
    await this.publish(message);
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
