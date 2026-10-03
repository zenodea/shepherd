import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextUsage, ConversationEntry, ConversationResult, QueuedMessage } from "@shepherd/protocol";
import type { HostConnection } from "../connection/host-client";

const PAGE = 150;
/** While the conversation is on screen: new messages show up within this. */
const POLL_MS = 1500;
/** No transcript yet (the agent hasn't written one, or its harness isn't supported): check now and then. */
const RETRY_MS = 10_000;

type State = {
  paneId: string | null;
  /** null until the host has answered once. */
  available: boolean | null;
  reason: string | null;
  agent: string | null;
  session: string | null;
  entries: ConversationEntry[];
  first: number;
  /** What the agent itself has queued, as of the last poll. */
  queued: QueuedMessage[];
  /** How full its context is, as of the last poll. */
  context: ContextUsage | null;
};

const EMPTY: State = {
  paneId: null,
  available: null,
  reason: null,
  agent: null,
  session: null,
  entries: [],
  first: 0,
  queued: [],
  context: null,
};

function merge(older: ConversationEntry[], newer: ConversationEntry[]): ConversationEntry[] {
  const seen = new Set(older.map((e) => e.id));
  return [...older, ...newer.filter((e) => !seen.has(e.id))].sort((a, b) => a.id - b.id);
}

/**
 * An agent's conversation from its transcript on the host: the latest page,
 * then new entries as they're written, and older pages on request.
 */
export function useConversation(client: HostConnection | null, paneId: string | null, online: boolean) {
  const [state, setState] = useState<State>(EMPTY);
  const current = state.paneId === paneId ? state : { ...EMPTY, paneId };
  const stateRef = useRef(current);
  useEffect(() => {
    stateRef.current = current;
  });
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    if (!client || !paneId || !online) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const known = stateRef.current;
      let fresh = known.paneId !== paneId || known.session === null;
      let next = RETRY_MS;
      try {
        const latest = () =>
          client.call<ConversationResult>("shepherd.conversation", {
            paneId,
            limit: PAGE,
          });
        let result = fresh
          ? await latest()
          : await client.call<ConversationResult>("shepherd.conversation", {
              paneId,
              after: known.entries.at(-1)?.id ?? known.first - 1,
            });
        // The agent started a new session (e.g. /clear): start over from its latest page.
        if (!fresh && result.available && result.session !== known.session) {
          result = await latest();
          fresh = true;
        }
        if (cancelled) return;
        if (!result.available) {
          setState({
            ...EMPTY,
            paneId,
            available: false,
            reason: result.reason,
          });
        } else if (fresh) {
          setState({
            paneId,
            available: true,
            reason: null,
            agent: result.agent,
            session: result.session,
            entries: result.entries,
            first: result.first,
            queued: result.queued ?? [],
            context: result.context ?? null,
          });
          next = POLL_MS;
        } else {
          const queued = result.queued ?? [];
          const context = result.context ?? null;
          setState((prev) => {
            if (prev.paneId !== paneId) return prev;
            const same = JSON.stringify([prev.queued, prev.context]) === JSON.stringify([queued, context]);
            if (!result.entries.length && same) return prev;
            return { ...prev, entries: result.entries.length ? merge(prev.entries, result.entries) : prev.entries, queued, context };
          });
          next = POLL_MS;
        }
      } catch {
        // offline or the host is busy; try again
        next = POLL_MS * 2;
      }
      if (!cancelled) timer = setTimeout(poll, next);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [client, paneId, online]);

  const loadOlder = useCallback(async () => {
    const known = stateRef.current;
    const oldest = known.entries[0]?.id;
    if (!client || !paneId || loadingOlder || oldest === undefined || oldest <= known.first) return;
    setLoadingOlder(true);
    try {
      const result = await client.call<ConversationResult>("shepherd.conversation", { paneId, before: oldest, limit: PAGE });
      if (result.available && result.session === known.session) {
        setState((prev) =>
          prev.paneId === paneId && prev.session === result.session ? { ...prev, entries: merge(result.entries, prev.entries) } : prev,
        );
      }
    } catch {
      // try again on the next scroll
    } finally {
      setLoadingOlder(false);
    }
  }, [client, paneId, loadingOlder]);

  const atStart = current.entries.length === 0 || current.entries[0]!.id <= current.first;
  return { ...current, loadOlder, loadingOlder, atStart };
}
