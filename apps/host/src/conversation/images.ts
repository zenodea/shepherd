// Images in transcripts: what the agent read (a screenshot, a PNG) or what you
// sent, stored as base64 in the record. The conversation only carries a
// reference; the data is read again from the transcript when the app asks.
import { closeSync, openSync, readSync } from "node:fs";
import type { ImageRef } from "@shepherd/protocol";
import { isRecord } from "./entries.ts";

export type FoundImage = { mime: string; data: string };

/** Every image in a record, in a fixed order, whichever agent wrote it. */
export function imagesIn(value: unknown): FoundImage[] {
  const found: FoundImage[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!isRecord(v)) return;
    // Claude: {type: "image", source: {type: "base64", media_type, data}}
    if (v.type === "image" && isRecord(v.source) && v.source.type === "base64" && typeof v.source.data === "string") {
      return void found.push({ mime: typeof v.source.media_type === "string" ? v.source.media_type : "image/png", data: v.source.data });
    }
    // pi: {type: "image", data, mimeType}
    if (v.type === "image" && typeof v.data === "string" && typeof v.mimeType === "string") return void found.push({ mime: v.mimeType, data: v.data });
    // Gemini: {inlineData: {mimeType, data}}
    if (isRecord(v.inlineData) && typeof v.inlineData.data === "string" && typeof v.inlineData.mimeType === "string" && v.inlineData.mimeType.startsWith("image/")) {
      return void found.push({ mime: v.inlineData.mimeType, data: v.inlineData.data });
    }
    // Data URLs: {type: "input_image", image_url: "data:image/png;base64,…"}
    if (typeof v.image_url === "string" && v.image_url.startsWith("data:image/")) {
      const match = /^data:(image\/[\w.+-]+);base64,(.*)$/s.exec(v.image_url);
      if (match) return void found.push({ mime: match[1]!, data: match[2]! });
    }
    for (const child of Object.values(v)) if (typeof child === "object" && child !== null) walk(child);
  };
  walk(value);
  return found;
}

/** References for a record's images: where the record starts in the file, and which image in it. */
export function imageRefs(lineOffset: number, images: FoundImage[]): ImageRef[] {
  return images.map((image, n) => ({ id: `${lineOffset}:${n}`, mime: image.mime, bytes: Math.floor((image.data.length * 3) / 4) }));
}

/** Biggest record read back for an image. */
const MAX_LINE = 48 * 1024 * 1024;

/** The record that starts at `offset` in the file, parsed. */
export function readRecordAt(path: string, offset: number): unknown {
  const fd = openSync(path, "r");
  try {
    const chunks: Buffer[] = [];
    let position = offset;
    let length = 0;
    for (;;) {
      const buffer = Buffer.alloc(1024 * 1024);
      const read = readSync(fd, buffer, 0, buffer.length, position);
      if (read === 0) break;
      const nl = buffer.subarray(0, read).indexOf(0x0a);
      chunks.push(buffer.subarray(0, nl === -1 ? read : nl));
      length += nl === -1 ? read : nl;
      if (nl !== -1 || length > MAX_LINE) break;
      position += read;
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    closeSync(fd);
  }
}
