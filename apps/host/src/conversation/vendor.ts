import type { AgentInfo, ConversationEntry, QueuedMessage, SubagentStatus } from "@shepherd/protocol";
import type { ConversationReader } from "./reader.ts";

/** A subagent as a vendor finds it: what the app sees, plus where its own transcript is. */
export type SubagentSource = {
  id: string;
  name: string;
  kind: string | null;
  depth: number;
  startedAt: string | null;
  /** Identifies its conversation: a file, or a database and a session in it. */
  transcript: string;
  open: () => ConversationReader;
  status: () => SubagentStatus;
  /** Whether this tool call in the parent's conversation is the one that started it. */
  startedBy: (call: Extract<ConversationEntry, { kind: "tool" }>) => boolean;
};

/**
 * Everything Shepherd knows about one agent harness's files. The rest of the
 * conversation code is vendor-neutral and only goes through this.
 */
export type Vendor = {
  /** herdr's agent kind, e.g. "claude". */
  readonly id: string;
  /** The conversation running in this pane (see SubagentSource.transcript), or null. */
  locate(agent: AgentInfo): string | null;
  open(transcript: string): ConversationReader;
  /** Messages waiting in the agent's own queue; absent when the vendor doesn't record one. */
  queued?(transcript: string, reader: ConversationReader): QueuedMessage[];
  /** Subagents the session started; absent when the vendor doesn't record them. */
  subagents?(transcript: string): SubagentSource[];
};

/** How long a subagent can go without writing anything before "running" means it was stopped. */
export const STALE_MS = 5 * 60_000;

/** A conversation kept in a database: the database's path and the session's id. */
export const inDatabase = (path: string, session: string) => `${path}#${session}`;

export function fromDatabase(transcript: string): { path: string; session: string } {
  const at = transcript.lastIndexOf("#");
  return { path: transcript.slice(0, at), session: transcript.slice(at + 1) };
}

/** A short name for a conversation, for the app to notice when it changes. */
export const sessionName = (transcript: string) => (transcript.includes("#") ? fromDatabase(transcript).session : transcript.replace(/^.*\//, "").replace(/\.jsonl?$/, ""));

export function vendorFor(vendors: readonly Vendor[], agent: AgentInfo): Vendor | null {
  const kind = agent.agent ?? agent.agent_session?.agent ?? "";
  return vendors.find((v) => v.id === kind) ?? null;
}
