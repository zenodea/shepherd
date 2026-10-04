import { EventEmitter } from "node:events";
import type { AgentInfo, AgentStatus, PaneAgentStatusChanged, StatusChange } from "@shepherd/protocol";
import { isAgentStatus } from "@shepherd/protocol";
import type { HerdrClient, Subscription } from "./herdr-client.ts";

const LIFECYCLE_SUBSCRIPTIONS = [
  { type: "pane.created" },
  { type: "pane.closed" },
  { type: "pane.exited" },
  { type: "pane.updated" },
  { type: "pane.agent_detected" },
];

const REFRESH_DEBOUNCE_MS = 150;
const MAX_RETRY_MS = 30_000;
/** After a failed read or status subscription while herdr is otherwise reachable. */
const REFRESH_RETRY_MS = 3000;

type TrackerEvents = {
  agents: [AgentInfo[]];
  status: [StatusChange];
  error: [Error];
};

/**
 * Keeps a live list of herdr agents and emits status transitions.
 *
 * herdr only delivers `pane.agent_status_changed` for pane ids named in the
 * subscription, so the tracker re-opens that subscription whenever the set of
 * agent panes changes. Every refresh also diffs statuses, so a transition that
 * lands between two subscriptions is still reported.
 */
export class AgentTracker extends EventEmitter<TrackerEvents> {
  private agents = new Map<string, AgentInfo>();
  private lifecycle: Subscription | null = null;
  private statusSub: Subscription | null = null;
  private statusPaneKey = "";
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshing: Promise<void> | null = null;
  private refreshQueued = false;
  private retryMs = 500;
  private stopped = true;
  private readonly herdr: HerdrClient;

  constructor(herdr: HerdrClient) {
    super();
    this.herdr = herdr;
  }

  list(): AgentInfo[] {
    return [...this.agents.values()];
  }

  get(paneId: string): AgentInfo | null {
    return this.agents.get(paneId) ?? null;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.lifecycle?.close();
    this.statusSub?.close();
    this.lifecycle = null;
    this.statusSub = null;
    this.statusPaneKey = "";
  }

  /** Re-read the agent list now (coalesced with any refresh in flight). */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshQueued = true;
      return this.refreshing;
    }
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null;
      if (this.refreshQueued && !this.stopped) {
        this.refreshQueued = false;
        void this.refresh();
      }
    });
    return this.refreshing;
  }

  private async connect(): Promise<void> {
    try {
      // Subscribe before reading so no lifecycle event is missed in between.
      const sub = await this.herdr.subscribe(LIFECYCLE_SUBSCRIPTIONS, () => this.scheduleRefresh());
      this.lifecycle = sub;
      this.retryMs = 500;
      void sub.closed.then(() => {
        if (this.lifecycle !== sub || this.stopped) return;
        this.lifecycle = null;
        this.statusSub?.close();
        this.statusSub = null;
        this.statusPaneKey = "";
        this.retry();
      });
      await this.refresh();
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      this.retry();
    }
  }

  private retry(): void {
    if (this.stopped) return;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    setTimeout(() => void (this.stopped || this.connect()), delay);
  }

  /** Try a failed refresh again later; while disconnected, reconnecting refreshes anyway. */
  private retryRefresh(): void {
    setTimeout(() => this.lifecycle && this.scheduleRefresh(), REFRESH_RETRY_MS);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer || this.stopped) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  private async doRefresh(): Promise<void> {
    let agents: AgentInfo[];
    try {
      const result = await this.herdr.request<{ agents: AgentInfo[] }>("agent.list");
      agents = result.agents;
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      this.retryRefresh();
      return;
    }
    this.apply(agents);
    await this.ensureStatusSubscription();
  }

  /** Replace the cached list, emitting status transitions and list changes. */
  apply(agents: AgentInfo[]): void {
    const next = new Map(agents.map((a) => [a.pane_id, a]));
    const before = JSON.stringify(this.list());

    for (const agent of agents) {
      const previous = this.agents.get(agent.pane_id);
      if (previous && previous.agent_status !== agent.agent_status) {
        this.emitStatus(agent.pane_id, agent.agent_status, previous.agent_status, agent);
      }
    }
    this.agents = next;
    if (JSON.stringify(agents) !== before) this.emit("agents", agents);
  }

  private async ensureStatusSubscription(): Promise<void> {
    const paneIds = [...this.agents.keys()].sort();
    const key = paneIds.join(",");
    if (key === this.statusPaneKey && this.statusSub) return;

    this.statusSub?.close();
    this.statusSub = null;
    this.statusPaneKey = key;
    if (paneIds.length === 0) return;

    try {
      const sub = await this.herdr.subscribe(
        paneIds.map((pane_id) => ({ type: "pane.agent_status_changed", pane_id })),
        (event) => {
          if (event.event === "pane.agent_status_changed") this.onStatusEvent(event.data as PaneAgentStatusChanged);
        },
      );
      if (this.statusPaneKey !== key || this.stopped) {
        sub.close();
        return;
      }
      this.statusSub = sub;
      void sub.closed.then(() => {
        if (this.statusSub !== sub) return;
        this.statusSub = null;
        this.statusPaneKey = "";
        this.retryRefresh();
      });
      // Catch transitions that happened while the subscription was being set up.
      this.scheduleRefresh();
    } catch (err) {
      this.statusPaneKey = "";
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      this.retryRefresh();
    }
  }

  private onStatusEvent(data: PaneAgentStatusChanged): void {
    if (!isAgentStatus(data.agent_status)) return;
    const agent = this.agents.get(data.pane_id);
    if (!agent) {
      this.scheduleRefresh();
      return;
    }
    if (agent.agent_status === data.agent_status) return;
    const previous = agent.agent_status;
    const updated: AgentInfo = { ...agent, agent_status: data.agent_status };
    this.agents.set(data.pane_id, updated);
    this.emitStatus(data.pane_id, data.agent_status, previous, updated);
    this.emit("agents", this.list());
  }

  private emitStatus(paneId: string, status: AgentStatus, previous: AgentStatus | null, agent: AgentInfo): void {
    this.emit("status", { type: "agent.status", paneId, status, previous, agent });
  }
}
