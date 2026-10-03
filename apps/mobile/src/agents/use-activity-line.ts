import { useEffect, useState } from "react";
import type { PaneReadResult } from "@shepherd/protocol";
import type { HostConnection } from "../connection/host-client";
import { activityLine } from "./activity-line";

const EVERY_MS = 2000;

/** While `active`: the agent's live status line ("Baking… · 5m 20s"), read from its screen. */
export function useActivityLine(client: HostConnection | null, paneId: string | null, active: boolean): string | null {
  const [line, setLine] = useState<{ paneId: string; text: string | null } | null>(null);
  useEffect(() => {
    if (!client || !paneId || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = async () => {
      try {
        const { read } = await client.call<{ read: PaneReadResult }>("agent.read", { target: paneId, source: "visible", format: "text" });
        if (!cancelled) setLine({ paneId, text: activityLine(read.text) });
      } catch {
        // keep the last one
      }
      if (!cancelled) timer = setTimeout(read, EVERY_MS);
    };
    void read();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [client, paneId, active]);
  return active && line?.paneId === paneId ? line.text : null;
}
