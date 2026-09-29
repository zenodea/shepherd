import { useEffect, useRef, useState } from "react";
import type { AgentInfo, PaneReadResult } from "@sheperd/protocol";
import type { HostConnection } from "../connection/host-client";
import { extractPrompt, type BlockedPrompt } from "./prompt-options";

const REFRESH_MS = 4000;

type Entry = { revision: number; prompt: BlockedPrompt };

/** For each blocked agent, what it is asking (re-read when its state changes). */
export function useBlockedPrompts(client: HostConnection | null, agents: AgentInfo[]): Record<string, BlockedPrompt> {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const inFlight = useRef(new Set<string>());
  const blocked = agents.filter((a) => a.agent_status === "blocked");
  const key = blocked.map((a) => `${a.pane_id}@${a.revision}`).join(",");

  useEffect(() => {
    if (!client || blocked.length === 0) return;
    let cancelled = false;

    const load = (force: boolean) => {
      for (const agent of blocked) {
        const cached = entries[agent.pane_id];
        if (!force && cached?.revision === agent.revision) continue;
        if (inFlight.current.has(agent.pane_id)) continue;
        inFlight.current.add(agent.pane_id);
        client
          .call<{ read: PaneReadResult }>("agent.read", { target: agent.pane_id, source: "visible", format: "text" })
          .then(({ read }) => {
            if (cancelled) return;
            setEntries((prev) => ({ ...prev, [agent.pane_id]: { revision: agent.revision, prompt: extractPrompt(read.text) } }));
          })
          .catch(() => {})
          .finally(() => inFlight.current.delete(agent.pane_id));
      }
    };

    load(false);
    const timer = setInterval(() => load(true), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // `key` captures the blocked set and revisions; `entries` is read, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);

  const result: Record<string, BlockedPrompt> = {};
  for (const agent of blocked) {
    const entry = entries[agent.pane_id];
    if (entry) result[agent.pane_id] = entry.prompt;
  }
  return result;
}
