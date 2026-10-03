import type { AgentInfo, ConversationEntry, QueuedMessage, SubagentStatus } from "@shepherd/protocol";
import type { Parser } from "./entries.ts";
import type { TranscriptReader } from "./reader.ts";

/** A subagent as a vendor finds it: what the app sees, plus where its own transcript is. */
export type SubagentSource = {
  id: string;
  name: string;
  kind: string | null;
  depth: number;
  startedAt: string | null;
  transcript: string;
  parser: () => Parser;
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
  /** The transcript of the session running in this pane, or null. */
  locate(agent: AgentInfo): string | null;
  parser(): Parser;
  /** Messages waiting in the agent's own queue; absent when the vendor doesn't record one. */
  queued?(transcript: string, reader: TranscriptReader): QueuedMessage[];
  /** Subagents the session started; absent when the vendor doesn't record them. */
  subagents?(transcript: string): SubagentSource[];
};

/** How long a subagent can go without writing anything before "running" means it was stopped. */
export const STALE_MS = 5 * 60_000;

export function vendorFor(vendors: readonly Vendor[], agent: AgentInfo): Vendor | null {
  const kind = agent.agent ?? agent.agent_session?.agent ?? "";
  return vendors.find((v) => v.id === kind) ?? null;
}
