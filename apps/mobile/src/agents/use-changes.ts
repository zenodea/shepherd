import { useCallback, useEffect, useState } from "react";
import type { ChangesMode, ChangesResult } from "@shepherd/protocol";
import type { HostConnection } from "../connection/host-client";

/** While the agent works its changes grow; look again this often. */
const WHILE_WORKING_MS = 20_000;

/**
 * What the agent has changed in its folder (from git, on the host): when
 * opened, when its status changes, and now and then while it works.
 */
export function useChanges(client: HostConnection | null, paneId: string | null, online: boolean, status: string | null, mode?: ChangesMode) {
  const [result, setResult] = useState<{ key: string; value: ChangesResult } | null>(null);
  const key = `${paneId}:${mode ?? ""}`;
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!client || !paneId || !online) return;
    let cancelled = false;
    client
      .call<ChangesResult>("shepherd.changes", mode ? { paneId, mode } : { paneId })
      .then((value) => !cancelled && setResult({ key, value }))
      .catch(() => {});
    const timer = status === "working" ? setTimeout(refresh, WHILE_WORKING_MS) : null;
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [client, paneId, online, status, mode, key, tick, refresh]);

  return { changes: result?.key === key ? result.value : null, refresh };
}
