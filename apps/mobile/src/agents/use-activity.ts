import { useCallback, useEffect, useState } from "react";
import type { ActivityEntry, ActivityResult } from "@sheperd/protocol";
import type { HostConnection } from "../connection/host-client";
import { loadPref, savePref } from "../connection/prefs";
import { NOTEWORTHY } from "./activity";

const PAGE = 100;
const REFRESH_DELAY_MS = 600;

/**
 * The host's activity log, kept fresh as agents change state, and which of it
 * you've already seen (per computer, by entry id, so clocks don't matter).
 */
export function useActivity(client: HostConnection | null, hostId: string | null, online: boolean) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [seen, setSeen] = useState<{ hostId: string | null; id: number } | null>(null);
  const [more, setMore] = useState(true);
  const seenKey = `activitySeen.${hostId ?? "none"}`;

  useEffect(() => {
    void loadPref(seenKey).then((v) => setSeen({ hostId, id: Number(v) || 0 }));
  }, [seenKey, hostId]);

  useEffect(() => {
    if (!online || !client) return;
    let cancelled = false;
    const load = () =>
      client.call<ActivityResult>("sheperd.activity", { limit: PAGE }).then(
        ({ entries: latest }) => {
          if (cancelled) return;
          setEntries(latest);
          setMore(latest.length === PAGE);
        },
        () => {}, // older hosts don't have the feed; the list just stays empty
      );
    void load();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = client.onStatusChange(() => {
      if (!timer) timer = setTimeout(() => ((timer = null), void load()), REFRESH_DELAY_MS);
    });
    return () => {
      cancelled = true;
      off();
      if (timer) clearTimeout(timer);
    };
  }, [client, online]);

  const loadMore = useCallback(async () => {
    const oldest = entries[entries.length - 1];
    if (!client || !oldest || !more) return;
    try {
      const { entries: older } = await client.call<ActivityResult>("sheperd.activity", { before: oldest.id, limit: PAGE });
      setEntries((prev) => [...prev, ...older.filter((e) => e.id < (prev[prev.length - 1]?.id ?? Infinity))]);
      setMore(older.length === PAGE);
    } catch {
      // try again on the next scroll
    }
  }, [client, entries, more]);

  const newest = entries[0]?.id ?? 0;
  // A host that lost its log starts counting again; don't hide new entries behind the old mark.
  const seenId = seen && seen.hostId === hostId && seen.id <= newest ? seen.id : 0;
  const loaded = seen !== null && seen.hostId === hostId;

  const markSeen = useCallback(() => {
    if (!newest) return;
    setSeen({ hostId, id: newest });
    void savePref(seenKey, String(newest));
  }, [newest, hostId, seenKey]);

  const unseen = loaded ? entries.filter((e) => e.id > seenId && NOTEWORTHY.includes(e.event)).length : 0;
  return { entries, more, loadMore, seenId, loaded, unseen, markSeen };
}
