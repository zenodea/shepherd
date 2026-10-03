// `shepherd.conversation`: an agent's conversation, read from its transcript.
import { basename, dirname, join } from "node:path";
import type { AgentInfo, ConversationParams, ConversationResult, ImageParams, ImageResult, QueuedMessage } from "@shepherd/protocol";
import { imagesIn, readRecordAt, type FoundImage } from "./images.ts";
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
/** base64 characters per answer: well under the relay's 1 MB message limit. */
const IMAGE_CHUNK = 256 * 1024;

export class Conversations {
  private readonly roots: Roots;
  private located = new Map<string, { at: number; path: string | null }>();
  private readers = new Map<string, TranscriptReader>();
  /** The last few images asked for, so the chunks of one don't each re-read the file. */
  private images = new Map<string, FoundImage>();
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
    const context = reader.context();
    return {
      available: true,
      agent: harness,
      session: basename(path, ".jsonl"),
      ...page,
      ...(queued ? { queued } : {}),
      ...(context ? { context } : {}),
    };
  }

  /**
   * The agent's own queue, as it records it. pi keeps its queue in memory
   * only, so it has none here yet (TODO: a small pi extension could write it
   * into pi's session file).
   */
  /** One image from the agent's transcript, in chunks of base64. */
  image(agent: AgentInfo | null, params: ImageParams): ImageResult {
    if (!agent) return { available: false, reason: "This tab isn't an agent." };
    const harness = harnessOf(agent);
    const path = harness ? this.locate(agent, harness) : null;
    if (!path) return { available: false, reason: "No conversation found for this agent." };
    const key = `${path}#${params.id}`;
    let image = this.images.get(key);
    if (!image) {
      const [offset, index] = params.id.split(":").map(Number) as [number, number];
      try {
        image = imagesIn(readRecordAt(path, offset))[index];
      } catch {
        image = undefined;
      }
      if (!image) return { available: false, reason: "That image isn't in the conversation any more." };
      this.images.set(key, image);
      if (this.images.size > 4) this.images.delete(this.images.keys().next().value!);
    }
    const from = params.from ?? 0;
    return { available: true, mime: image.mime, total: image.data.length, from, data: image.data.slice(from, from + IMAGE_CHUNK) };
  }

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

export function imageParams(params: Record<string, unknown>, isPaneId: (v: unknown) => v is string): ImageParams | null {
  const { paneId, id, from } = params;
  if (!isPaneId(paneId) || typeof id !== "string" || !/^\d{1,15}:\d{1,4}$/.test(id)) return null;
  if (from !== undefined && !(Number.isInteger(from) && (from as number) >= 0)) return null;
  return { paneId, id, ...(from !== undefined ? { from: from as number } : {}) };
}
