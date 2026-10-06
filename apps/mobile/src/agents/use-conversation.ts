import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContextUsage, ConversationEntry, ConversationResult, QueuedMessage, Subagent } from "@shepherd/protocol";
import type { HostConnection } from "../connection/host-client";
import { loadChat, saveChat } from "../connection/offline-store";

const PAGE = 150;
/** While the conversation is on screen: new messages show up within this. */
const POLL_MS = 1000;
/** No transcript yet (the agent hasn't written one, or its harness isn't supported): check now and then. */
const RETRY_MS = 10_000;
/** How long after the last change the phone's copy is written. */
const SAVE_MS = 1500;

type State = {
  /** The pane, and the subagent when it's one of the agent's subagents. */
  scope: string | null;
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
  subagents: Subagent[];
  /** The phone's copy from last time, shown until the host answers (and all along without a connection). */
  saved: boolean;
};

const EMPTY: State = {
  scope: null,
  available: null,
  reason: null,
  agent: null,
  session: null,
  entries: [],
  first: 0,
  queued: [],
  context: null,
  subagents: [],
  saved: false,
};

function merge(older: ConversationEntry[], newer: ConversationEntry[]): ConversationEntry[] {
  const seen = new Set(older.map((e) => e.id));
  return [...older, ...newer.filter((e) => !seen.has(e.id))].sort((a, b) => a.id - b.id);
}

/**
 * An agent's conversation from its transcript on the host: the latest page,
 * then new entries as they're written, and older pages on request.
 */
export function useConversation(client: HostConnection | null, paneId: string | null, online: boolean, subagent: string | null = null, hostId: string | null = null) {
  const scope = paneId && (subagent ? `${paneId}/${subagent}` : paneId);
  const [state, setState] = useState<State>(EMPTY);
  // What this chat looked like last time, read from the phone: something to read at once, and offline.
  const saved = useMemo(() => (hostId && scope ? loadChat(hostId, scope) : null), [hostId, scope]);
  const current: State =
    state.scope === scope
      ? state
      : saved
        ? { ...EMPTY, scope, available: true, agent: saved.agent, session: saved.session, entries: saved.entries, first: saved.first, subagents: saved.subagents, saved: true }
        : { ...EMPTY, scope };
  const stateRef = useRef(current);
  useEffect(() => {
    stateRef.current = current;
  });
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    if (!client || !paneId || !online) return;
    const target = subagent ? { paneId, subagent } : { paneId };
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const known = stateRef.current;
      // Showing the phone's copy: start from the host's latest page (and keep the copy's older messages if it's the same session).
      let fresh = known.scope !== scope || known.session === null || known.saved;
      let next = RETRY_MS;
      try {
        const latest = () =>
          client.call<ConversationResult>("shepherd.conversation", {
            ...target,
            limit: PAGE,
          });
        let result = fresh
          ? await latest()
          : await client.call<ConversationResult>("shepherd.conversation", {
              ...target,
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
            scope,
            available: false,
            reason: result.reason,
          });
        } else if (fresh) {
          setState({
            scope,
            available: true,
            reason: null,
            agent: result.agent,
            session: result.session,
            entries: known.saved && known.session === result.session ? merge(known.entries, result.entries) : result.entries,
            first: result.first,
            queued: result.queued ?? [],
            context: result.context ?? null,
            subagents: result.subagents ?? [],
            saved: false,
          });
          next = POLL_MS;
        } else {
          const queued = result.queued ?? [];
          const context = result.context ?? null;
          const subagents = result.subagents ?? [];
          setState((prev) => {
            if (prev.scope !== scope) return prev;
            const same = JSON.stringify([prev.queued, prev.context, prev.subagents]) === JSON.stringify([queued, context, subagents]);
            if (!result.entries.length && same) return prev;
            return { ...prev, entries: result.entries.length ? merge(prev.entries, result.entries) : prev.entries, queued, context, subagents };
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
  }, [client, paneId, subagent, scope, online]);

  // Keep the phone's copy up to date with what the host sent.
  useEffect(() => {
    if (!hostId || !scope || current.saved || !current.available || !current.session) return;
    const chat = { agent: current.agent, session: current.session, entries: current.entries, first: current.first, subagents: current.subagents };
    const timer = setTimeout(() => saveChat(hostId, scope, chat), SAVE_MS);
    return () => clearTimeout(timer);
  }, [hostId, scope, current.saved, current.available, current.agent, current.session, current.entries, current.first, current.subagents]);

  const loadOlder = useCallback(async () => {
    const known = stateRef.current;
    const oldest = known.entries[0]?.id;
    if (!client || !paneId || loadingOlder || oldest === undefined || oldest <= known.first) return;
    setLoadingOlder(true);
    try {
      const result = await client.call<ConversationResult>("shepherd.conversation", { paneId, ...(subagent ? { subagent } : {}), before: oldest, limit: PAGE });
      if (result.available && result.session === known.session) {
        setState((prev) =>
          prev.scope === scope && prev.session === result.session ? { ...prev, entries: merge(result.entries, prev.entries) } : prev,
        );
      }
    } catch {
      // try again on the next scroll
    } finally {
      setLoadingOlder(false);
    }
  }, [client, paneId, subagent, scope, loadingOlder]);

  const atStart = current.entries.length === 0 || current.entries[0]!.id <= current.first;
  return { ...current, loadOlder, loadingOlder, atStart };
}
