// Follow a transcript file as the agent appends to it, parsing only the new
// lines each time. Transcripts can reach hundreds of MB, so a big file is read
// from its last few MB.
import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { ContextUsage, ConversationEntry, QueuedMessage } from "@shepherd/protocol";
import type { Draft, Parser } from "./entries.ts";
import { imageRefs, imagesIn } from "./images.ts";

// Cheap checks before looking for images in a record.
const IMAGE_MARK = Buffer.from('"image"');
const DATA_IMAGE_MARK = Buffer.from("data:image/");

/** How much of a file to read when first opening it, or after a big jump. */
export const TAIL_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const CHUNK = 1024 * 1024;
const NEWLINE = 0x0a;

export type Page = { entries: ConversationEntry[]; first: number; last: number };

export class TranscriptReader {
  readonly path: string;
  private readonly makeParser: () => Parser;
  private parse: Parser;
  private offset = 0;
  private partial: Buffer = Buffer.alloc(0);
  private entries: ConversationEntry[] = [];
  private nextId = 0;
  private ino = -1;

  constructor(path: string, makeParser: () => Parser) {
    this.path = path;
    this.makeParser = makeParser;
    this.parse = makeParser();
  }

  /** Read whatever was appended since last time. */
  refresh(): void {
    const stat = statSync(this.path);
    if (stat.ino !== this.ino || stat.size < this.offset) this.reset(stat.ino);
    if (stat.size === this.offset) return;

    let skipPartialLine = false;
    if (stat.size - this.offset > TAIL_BYTES) {
      const starting = this.offset === 0;
      this.offset = stat.size - TAIL_BYTES;
      this.partial = Buffer.alloc(0);
      skipPartialLine = true;
      this.push({ kind: "notice", text: starting ? "Earlier messages are too far back to show here" : "Some messages were skipped" });
    }

    const fd = openSync(this.path, "r");
    try {
      while (this.offset < stat.size) {
        const buffer = Buffer.alloc(Math.min(CHUNK, stat.size - this.offset));
        const read = readSync(fd, buffer, 0, buffer.length, this.offset);
        if (read === 0) break;
        this.offset += read;
        let data = Buffer.concat([this.partial, buffer.subarray(0, read)]);
        if (skipPartialLine) {
          const nl = data.indexOf(NEWLINE);
          if (nl === -1) {
            this.partial = Buffer.alloc(0);
            continue;
          }
          data = data.subarray(nl + 1);
          skipPartialLine = false;
        }
        // Where `data` starts in the file, so each record knows its own offset.
        const base = this.offset - data.length;
        let start = 0;
        for (let nl = data.indexOf(NEWLINE); nl !== -1; nl = data.indexOf(NEWLINE, start)) {
          this.line(data.subarray(start, nl), base + start);
          start = nl + 1;
        }
        // Keep an unfinished last line for next time.
        this.partial = Buffer.from(data.subarray(start));
      }
    } finally {
      closeSync(fd);
    }
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(-MAX_ENTRIES);
  }

  /** How full the agent's context is, from the latest usage it recorded. */
  context(): ContextUsage | null {
    return this.parse.context?.() ?? null;
  }

  /** The agent's message queue, when its transcript records one. */
  queued(): QueuedMessage[] | null {
    return this.parse.queued?.() ?? null;
  }

  page({ after, before, limit }: { after?: number; before?: number; limit: number }): Page {
    let entries: ConversationEntry[];
    if (after !== undefined) entries = this.entries.filter((e) => e.id > after).slice(0, limit);
    else if (before !== undefined) entries = this.entries.filter((e) => e.id < before).slice(-limit);
    else entries = this.entries.slice(-limit);
    return { entries, first: this.entries[0]?.id ?? this.nextId, last: this.nextId - 1 };
  }

  private line(bytes: Buffer, offset: number): void {
    if (bytes.length === 0) return;
    let record: unknown;
    try {
      record = JSON.parse(bytes.toString("utf8"));
    } catch {
      return;
    }
    if (typeof record !== "object" || record === null || Array.isArray(record)) return;
    const drafts = this.parse(record as Record<string, unknown>);
    // Images go with the message or tool result they came in, as references only.
    if (drafts.length && (bytes.includes(IMAGE_MARK) || bytes.includes(DATA_IMAGE_MARK))) {
      const found = imagesIn(record);
      const owner = drafts.find((d) => d.kind === "user" || d.kind === "tool_result");
      if (found.length && owner) owner.images = imageRefs(offset, found);
    }
    for (const draft of drafts) this.push(draft);
  }

  private push(draft: Draft): void {
    this.entries.push({ ...draft, id: this.nextId++ } as ConversationEntry);
  }

  /** A different or shortened file: start over, keeping ids increasing. */
  private reset(ino: number): void {
    this.ino = ino;
    this.offset = 0;
    this.partial = Buffer.alloc(0);
    this.entries = [];
    this.parse = this.makeParser();
  }
}
