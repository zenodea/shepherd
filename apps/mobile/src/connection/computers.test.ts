import { describe, expect, it } from "vitest";
import type { AgentInfo, AgentStatus } from "@shepherd/protocol";
import { blockedAgents, combineStores, countAgents, peerHosts, sortAgents, visibleAgents } from "./computers";
import type { HostState } from "./host-client";
import type { SavedHost } from "./settings-store";

const RANK: Record<AgentStatus, number> = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };

function agent(paneId: string, status: AgentStatus, cwd: string): AgentInfo {
  const [workspace] = paneId.split(":");
  return { agent: "claude", agent_status: status, focused: false, pane_id: paneId, tab_id: `${workspace}:t1`, workspace_id: workspace!, terminal_id: paneId, cwd, revision: 1 };
}

function state(status: HostState["status"], agents: AgentInfo[]): HostState {
  return { status, network: true, error: null, host: null, activeUrl: null, urls: [], device: null, agents };
}

const host = (id: string): SavedHost => ({ id, urls: [`ws://${id}`], token: "t" });

describe("peerHosts", () => {
  it("keeps every computer but the one in use, in saved order", () => {
    expect(peerHosts([host("a"), host("b"), host("c")], "b").map((h) => h.id)).toEqual(["a", "c"]);
    expect(peerHosts([host("a")], "a")).toEqual([]);
  });
});

describe("sortAgents", () => {
  it("puts agents that need you first, then sorts by project and pane", () => {
    const sorted = sortAgents(
      [agent("w2:p1", "idle", "/code/web"), agent("w1:p2", "working", "/code/web"), agent("w3:p1", "working", "/code/api"), agent("w4:p1", "blocked", "/code/zed")],
      RANK,
    );
    expect(sorted.map((a) => a.pane_id)).toEqual(["w4:p1", "w3:p1", "w1:p2", "w2:p1"]);
  });
});

describe("visibleAgents and blockedAgents", () => {
  const agents = [agent("w1:p1", "blocked", "/code/api"), agent("w1:p2", "working", "/code/api")];

  it("lists agents while connected or reconnecting, not when unreachable", () => {
    expect(visibleAgents(state("online", agents))).toHaveLength(2);
    expect(visibleAgents(state("connecting", agents))).toHaveLength(2);
    expect(visibleAgents(state("offline", agents))).toEqual([]);
    expect(visibleAgents(state("unauthorized", agents))).toEqual([]);
  });

  it("only counts an agent as waiting on you when its computer is connected", () => {
    expect(blockedAgents(state("online", agents)).map((a) => a.pane_id)).toEqual(["w1:p1"]);
    expect(blockedAgents(state("connecting", agents))).toEqual([]);
  });
});

describe("countAgents", () => {
  it("adds up every computer", () => {
    const counts = countAgents([
      state("online", [agent("w1:p1", "blocked", "/a"), agent("w1:p2", "working", "/a")]),
      state("online", [agent("w1:p1", "blocked", "/b"), agent("w2:p1", "done", "/b")]),
      state("offline", [agent("w1:p1", "working", "/c")]),
    ]);
    expect(counts).toEqual({ total: 4, working: 1, blocked: 2 });
  });
});

describe("combineStores", () => {
  function store(initial: number) {
    let value = initial;
    const listeners = new Set<() => void>();
    return {
      getState: () => value,
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      set(next: number) {
        value = next;
        for (const l of listeners) l();
      },
      listeners,
    };
  }

  it("keeps the same snapshot until a store changes", () => {
    const a = store(1);
    const b = store(2);
    const combined = combineStores([a, b]);
    const first = combined.getSnapshot();
    expect(first).toEqual([1, 2]);
    expect(combined.getSnapshot()).toBe(first);
    b.set(3);
    expect(combined.getSnapshot()).toEqual([1, 3]);
    expect(combined.getSnapshot()).not.toBe(first);
  });

  it("subscribes to every store and unsubscribes from all", () => {
    const a = store(1);
    const b = store(2);
    const combined = combineStores([a, b]);
    let calls = 0;
    const unsubscribe = combined.subscribe(() => calls++);
    a.set(5);
    b.set(6);
    expect(calls).toBe(2);
    unsubscribe();
    expect(a.listeners.size + b.listeners.size).toBe(0);
  });
});
