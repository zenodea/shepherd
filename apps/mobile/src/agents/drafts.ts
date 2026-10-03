import { useSyncExternalStore } from "react";
import { loadPref, savePref } from "../connection/prefs";

// What you've typed for an agent but not sent yet, per computer and agent,
// kept until you send it (or clear it).

const PREF = "drafts";
const MAX_DRAFTS = 40;
const MAX_LENGTH = 8000;

let drafts = new Map<string, string>();
let ready = false;
const listeners = new Set<() => void>();

void loadPref(PREF)
  .then((saved) => {
    if (saved) drafts = new Map(Object.entries(JSON.parse(saved) as Record<string, string>));
  })
  .catch(() => {})
  .finally(() => {
    ready = true;
    listeners.forEach((l) => l());
  });

/** False until the saved drafts have loaded. */
export function useDraftsReady(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => ready,
  );
}

export function getDraft(key: string): string {
  return drafts.get(key) ?? "";
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function saveDraft(key: string, text: string): void {
  drafts.delete(key);
  if (text.trim()) drafts.set(key, text.slice(0, MAX_LENGTH));
  // Newest last; keep only the most recent few.
  while (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value!);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void savePref(PREF, JSON.stringify(Object.fromEntries(drafts))), 400);
}

// Changes made from elsewhere (e.g. mentioning a file from its diff), so an
// open composer picks them up.
const revisions = new Map<string, number>();

/** Add to an agent's draft from outside its composer. */
export function appendToDraft(key: string, text: string): void {
  const current = getDraft(key);
  saveDraft(key, current && !/\s$/.test(current) ? `${current} ${text}` : `${current}${text}`);
  revisions.set(key, (revisions.get(key) ?? 0) + 1);
  listeners.forEach((l) => l());
}

/** Increases when the draft is changed from outside its composer. */
export function useDraftRevision(key: string): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => revisions.get(key) ?? 0,
  );
}
