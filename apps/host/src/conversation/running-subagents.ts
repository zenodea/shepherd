import { EventEmitter } from "node:events";
import type { AgentInfo, SubagentsResult } from "@shepherd/protocol";

const EVERY_MS = 10_000;

/**
 * How many subagents are still running for agents that aren't working
 * themselves, so the agent list can say so. Checked only while someone listens.
 */
export class RunningSubagents extends EventEmitter<{ changed: [] }> {
  private counts = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private readonly subagents: (agent: AgentInfo) => SubagentsResult;
  private readonly agents: () => AgentInfo[];

  constructor(subagents: (agent: AgentInfo) => SubagentsResult, agents: () => AgentInfo[]) {
    super();
    this.subagents = subagents;
    this.agents = agents;
  }

  count(paneId: string): number {
    return this.counts.get(paneId) ?? 0;
  }

  start(everyMs = EVERY_MS): void {
    this.timer ??= setInterval(() => this.check(), everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  check(): void {
    if (this.listenerCount("changed") === 0) return;
    const next = new Map<string, number>();
    for (const agent of this.agents()) {
      if (agent.agent_status === "working") continue;
      const list = this.subagents(agent);
      const running = list.available ? list.subagents.filter((s) => s.status === "running").length : 0;
      if (running > 0) next.set(agent.pane_id, running);
    }
    const changed = next.size !== this.counts.size || [...next].some(([pane, n]) => this.counts.get(pane) !== n);
    this.counts = next;
    if (changed) this.emit("changed");
  }
}
