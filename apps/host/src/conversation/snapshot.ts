import type { ContextUsage, QueuedMessage } from "@shepherd/protocol";
import type { Draft } from "./entries.ts";
import type { FoundImage } from "./images.ts";
import { EntryLog } from "./reader.ts";

/** An entry with a key that stays the same across reloads, e.g. a message or part id. */
export type KeyedDraft = Draft & { key: string };

/** A conversation the agent keeps in a database rather than a file it appends to. */
export type Snapshot = {
  /** Changes whenever the conversation does: cheap to ask for, compared before reloading. */
  version(): string;
  /** The whole conversation, oldest first. */
  load(): { drafts: KeyedDraft[]; context?: ContextUsage | null; queued?: QueuedMessage[] };
  image?(id: string): FoundImage | null;
};

/**
 * Reloads the conversation when it changes, and numbers each entry the first
 * time its key shows up: entries keep their ids, so the app's "what's after
 * id N" polling keeps working. An entry whose content changes later keeps the
 * version first seen.
 */
export class SnapshotReader extends EntryLog {
  private readonly source: Snapshot;
  private seen = new Set<string>();
  private version: string | null = null;
  private latest: { context: ContextUsage | null; queued: QueuedMessage[] | null } = { context: null, queued: null };

  constructor(source: Snapshot) {
    super();
    this.source = source;
  }

  refresh(): void {
    const version = this.source.version();
    if (version === this.version) return;
    this.version = version;
    const { drafts, context = null, queued = null } = this.source.load();
    this.latest = { context, queued };
    for (const { key, ...draft } of drafts) {
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.push(draft as Draft);
    }
    this.trim();
  }

  context(): ContextUsage | null {
    return this.latest.context;
  }

  queued(): QueuedMessage[] | null {
    return this.latest.queued;
  }

  image(id: string): FoundImage | null {
    return this.source.image?.(id) ?? null;
  }
}
