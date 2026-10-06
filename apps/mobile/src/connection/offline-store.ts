import { Directory, File, Paths } from "expo-file-system";
import type { AgentInfo, ConversationEntry, Subagent } from "@shepherd/protocol";
import { cacheName, trimChat, type SavedChat } from "./offline-cache";

// What you last saw, kept on the phone so it can be read without a connection:
// each computer's agents, and the latest messages of the chats you opened.
// In the app's private storage; forgetting a computer deletes its copies.

const MAX_CHATS = 40;
let folder: Directory | null = null;

/** The folder, made on first use; null where there's no file system (the web demo, tests). */
function dir(): Directory | null {
  if (folder) return folder;
  try {
    const made = new Directory(Paths.document, "offline");
    if (!made.exists) made.create({ intermediates: true, idempotent: true });
    folder = made;
    return folder;
  } catch {
    return null;
  }
}

function read<T>(name: string): T | null {
  try {
    const at = dir();
    if (!at) return null;
    const file = new File(at, name);
    return file.exists ? (JSON.parse(file.textSync()) as T) : null;
  } catch {
    return null;
  }
}

function write(name: string, value: unknown): void {
  try {
    const at = dir();
    if (!at) return;
    const file = new File(at, name);
    if (!file.exists) file.create();
    file.write(JSON.stringify(value));
  } catch {
    // full or unavailable: the copy is a convenience
  }
}

export function loadAgents(hostId: string): AgentInfo[] {
  return read<AgentInfo[]>(cacheName(hostId, "agents")) ?? [];
}

export function saveAgents(hostId: string, agents: AgentInfo[]): void {
  write(cacheName(hostId, "agents"), agents);
}

export function loadChat(hostId: string, scope: string): SavedChat | null {
  return read<SavedChat>(cacheName(hostId, `chat-${scope}`));
}

export function saveChat(hostId: string, scope: string, chat: { agent: string | null; session: string | null; entries: ConversationEntry[]; first: number; subagents: Subagent[] }): void {
  write(cacheName(hostId, `chat-${scope}`), trimChat(chat));
  prune();
}

/** Keep the most recently saved chats only. */
function prune(): void {
  try {
    const chats = (dir()?.list() ?? []).filter((f): f is File => f instanceof File && f.name.includes("chat-"));
    if (chats.length <= MAX_CHATS) return;
    chats.sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));
    for (const old of chats.slice(MAX_CHATS)) old.delete();
  } catch {
    // try again next time
  }
}

/** Delete everything kept for a computer (when it's forgotten). */
export function forgetSaved(hostId: string): void {
  try {
    const prefix = cacheName(hostId, "");
    for (const file of dir()?.list() ?? []) if (file instanceof File && file.name.startsWith(prefix)) file.delete();
  } catch {
    // nothing to delete
  }
}
