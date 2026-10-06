import type { ConversationEntry, Subagent } from "@shepherd/protocol";

/** Messages kept per chat: plenty to read back, small enough to load instantly. */
export const SAVED_ENTRIES = 400;

export type SavedChat = { agent: string | null; session: string | null; entries: ConversationEntry[]; first: number; subagents: Subagent[]; savedAt: number };

/** A file name for something kept for a computer: `<computer>__<what>.json`, safe on any file system. */
export function cacheName(hostId: string, what: string): string {
  const safe = (s: string) => s.replace(/[^\w.-]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
  return `${safe(hostId)}__${what ? `${safe(what)}.json` : ""}`;
}

/** The latest messages of a chat, and where its history really starts so older pages can still be asked for once online. */
export function trimChat(chat: Omit<SavedChat, "savedAt">, now = Date.now()): SavedChat {
  return { ...chat, entries: chat.entries.slice(-SAVED_ENTRIES), savedAt: now };
}
