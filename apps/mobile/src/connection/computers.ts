// Pure helpers for showing every paired computer at once (no React Native
// imports, so they can be unit tested).
import type { AgentInfo, AgentStatus } from "@shepherd/protocol";
import { projectOf } from "../agents/agents";
import type { HostState } from "./host-client";
import type { SavedHost } from "./settings-store";

type Store<S> = { subscribe: (listener: () => void) => () => void; getState: () => S };

/** The paired computers other than the one in use, in their saved order. */
export function peerHosts(hosts: SavedHost[], activeId: string | null | undefined): SavedHost[] {
  return hosts.filter((h) => h.id !== activeId);
}

/**
 * One store over several (for `useSyncExternalStore`): its snapshot is each
 * store's state in order, and stays the same array until one of them changes.
 */
export function combineStores<S>(stores: Store<S>[]): { subscribe: (listener: () => void) => () => void; getSnapshot: () => S[] } {
  let last: S[] = [];
  return {
    subscribe: (listener) => {
      const subs = stores.map((s) => s.subscribe(listener));
      return () => {
        for (const unsubscribe of subs) unsubscribe();
      };
    },
    getSnapshot: () => {
      const states = stores.map((s) => s.getState());
      if (states.length !== last.length || states.some((state, i) => state !== last[i])) last = states;
      return last;
    },
  };
}

/** A computer's agents in list order: those that need you first, then by project. */
export function sortAgents(agents: AgentInfo[], rank: Record<AgentStatus, number>): AgentInfo[] {
  return [...agents].sort(
    (a, b) =>
      rank[a.agent_status] - rank[b.agent_status] ||
      projectOf(a).localeCompare(projectOf(b)) ||
      a.pane_id.localeCompare(b.pane_id),
  );
}

/**
 * Agents listed for a computer: what it reported while connected, kept while
 * it reconnects so the list doesn't flash empty.
 */
export function visibleAgents(state: HostState): AgentInfo[] {
  return state.status === "online" || state.status === "connecting" ? state.agents : [];
}

/** Agents waiting on you; only from a connected computer, since answering needs the connection. */
export function blockedAgents(state: HostState): AgentInfo[] {
  return state.status === "online" ? state.agents.filter((a) => a.agent_status === "blocked") : [];
}

/** Totals across every computer, for the summary under the title. */
export function countAgents(states: HostState[]): { total: number; working: number; blocked: number } {
  let total = 0;
  let working = 0;
  let blocked = 0;
  for (const state of states) {
    const agents = visibleAgents(state);
    total += agents.length;
    working += agents.filter((a) => a.agent_status === "working").length;
    blocked += blockedAgents(state).length;
  }
  return { total, working, blocked };
}
