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
