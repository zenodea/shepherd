// `shepherd.conversation`: an agent's conversation, read from its transcript.
import { basename, dirname, join } from "node:path";
import type { AgentInfo, ConversationParams, ConversationResult, QueuedMessage } from "@shepherd/protocol";
import { claudeParser } from "./claude.ts";
import { CodexQueue, codexThreadId } from "./codex-queue.ts";
import { codexParser } from "./codex.ts";
import type { Parser } from "./entries.ts";
import { defaultRoots, harnessOf, locateTranscript, type Harness, type Roots } from "./locate.ts";
import { piParser } from "./pi.ts";
import { TranscriptReader } from "./reader.ts";

const PARSERS: Record<Harness, () => Parser> = { claude: claudeParser, codex: codexParser, pi: piParser };

const DEFAULT_LIMIT = 150;
const MAX_LIMIT = 500;
/** Look for a newer session file (after /clear, a restart…) at most this often per pane. */
const LOCATE_EVERY_MS = 4000;
const MAX_READERS = 8;

export class Conversations {
  private readonly roots: Roots;
  private located = new Map<string, { at: number; path: string | null }>();
  private readers = new Map<string, TranscriptReader>();
  private readonly codexQueue: CodexQueue;

  constructor(roots: Roots = defaultRoots()) {
    this.roots = roots;
    // Next to Codex's sessions folder.
    this.codexQueue = new CodexQueue(join(dirname(roots.codex), "queue_1.sqlite"));
  }

  get(agent: AgentInfo | null, params: ConversationParams): ConversationResult {
    if (!agent) return { available: false, reason: "This tab isn't an agent." };
    const harness = harnessOf(agent);
    if (!harness) return { available: false, reason: `Conversations aren't available for ${agent.agent ?? "this agent"} yet.` };

    const path = this.locate(agent, harness);
    if (!path) return { available: false, reason: "No conversation found for this agent yet." };

    let reader = this.readers.get(path);
    if (!reader) {
      reader = new TranscriptReader(path, PARSERS[harness]);
      this.readers.set(path, reader);
      if (this.readers.size > MAX_READERS) this.readers.delete(this.readers.keys().next().value!);
    } else {
      // Most recently used last.
      this.readers.delete(path);
      this.readers.set(path, reader);
    }
    try {
      reader.refresh();
    } catch {
      this.readers.delete(path);
      this.located.delete(`${agent.pane_id} ${harness}`);
      return { available: false, reason: "Couldn't read this agent's conversation." };
    }

    const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
    const page = reader.page({ after: params.after, before: params.before, limit });
    const queued = this.queued(agent, harness, path, reader);
    return { available: true, agent: harness, session: basename(path, ".jsonl"), ...page, ...(queued ? { queued } : {}) };
  }

  /**
   * The agent's own queue, as it records it. pi keeps its queue in memory
   * only, so it has none here yet (TODO: a small pi extension could write it
   * into pi's session file).
   */
  private queued(agent: AgentInfo, harness: Harness, path: string, reader: TranscriptReader): QueuedMessage[] | null {
    let queued: QueuedMessage[] | null = null;
    if (harness === "claude") queued = reader.queued();
    else if (harness === "codex") {
      const thread = codexThreadId(path);
      queued = thread ? this.codexQueue.read(thread) : [];
    }
    // An idle agent has nothing waiting; anything left was abandoned (it exited mid-queue).
    if (queued && agent.agent_status !== "working" && agent.agent_status !== "blocked") return [];
    return queued;
  }

  private locate(agent: AgentInfo, harness: Harness): string | null {
    // Keyed by harness too: another agent can start in the same pane.
    const key = `${agent.pane_id} ${harness}`;
    const cached = this.located.get(key);
    if (cached && Date.now() - cached.at < LOCATE_EVERY_MS) return cached.path;
    const path = locateTranscript(agent, harness, this.roots);
    this.located.set(key, { at: Date.now(), path });
    return path;
  }
}

/** Validate the app's parameters; null when malformed. */
export function conversationParams(params: Record<string, unknown>, isPaneId: (v: unknown) => v is string): ConversationParams | null {
  const { paneId, after, before, limit } = params;
  if (!isPaneId(paneId)) return null;
  const int = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= -1);
  if (!int(after) || !int(before) || !int(limit)) return null;
  return {
    paneId,
    ...(after !== undefined ? { after: after as number } : {}),
    ...(before !== undefined ? { before: before as number } : {}),
    ...(limit !== undefined ? { limit: limit as number } : {}),
  };
}
