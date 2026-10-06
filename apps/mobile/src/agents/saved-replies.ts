import { useSyncExternalStore } from "react";
import { loadPref, savePref } from "../connection/prefs";

// Phrases you send often, one tap from an empty message box. Kept on the phone,
// the same for every agent and computer.

const PREF = "saved-replies";
const MAX = 20;
const MAX_LENGTH = 500;
export const DEFAULT_REPLIES = ["continue", "run the tests", "commit and push", "explain what you changed"];

let replies: string[] = DEFAULT_REPLIES;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

void loadPref(PREF)
  .then((saved) => {
    if (saved) replies = (JSON.parse(saved) as unknown[]).filter((r): r is string => typeof r === "string");
  })
  .catch(() => {})
  .finally(notify);

function save(next: string[]): void {
  replies = next;
  notify();
  void savePref(PREF, JSON.stringify(next));
}

export function useSavedReplies(): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => replies,
  );
}

/** Add one (or, with `replacing`, change that one in place); an empty or repeated phrase changes nothing. */
export function saveReply(text: string, replacing?: string): void {
  const reply = text.trim().slice(0, MAX_LENGTH);
  if (!reply || (reply !== replacing && replies.includes(reply))) return;
  save(replacing !== undefined && replies.includes(replacing) ? replies.map((r) => (r === replacing ? reply : r)) : [...replies, reply].slice(-MAX));
}

export function removeReply(text: string): void {
  save(replies.filter((r) => r !== text));
}
