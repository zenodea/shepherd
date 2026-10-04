import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UploadParams, UploadResult } from "@shepherd/protocol";

const MAX_BASE64 = 20 * 1024 * 1024;
const MAX_CHUNK = 512 * 1024;
const MAX_PENDING = 3;
const PENDING_MS = 5 * 60_000;
const KEEP_MS = 7 * 24 * 60 * 60_000;
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic" };

export class UploadError extends Error {}

/** Images sent from the phone, saved where agents can read them: a temporary folder, cleared after a week. */
export class Uploads {
  dir: string;
  private pending = new Map<string, { chunks: string[]; size: number; mime: string; at: number }>();

  constructor(dir = join(tmpdir(), "shepherd-uploads")) {
    this.dir = dir;
  }

  receive({ uploadId, mime, data, done }: UploadParams): UploadResult {
    const ext = EXTENSIONS[mime];
    if (!ext) throw new UploadError("Only PNG, JPEG, WebP, GIF or HEIC images can be sent.");
    if (!/^[\w-]{8,64}$/.test(uploadId)) throw new UploadError("Bad upload id.");
    if (data.length > MAX_CHUNK || !/^[A-Za-z0-9+/=]*$/.test(data)) throw new UploadError("Bad image data.");
    this.expire();
    let upload = this.pending.get(uploadId);
    if (!upload) {
      if (this.pending.size >= MAX_PENDING) throw new UploadError("Too many images on the way at once.");
      upload = { chunks: [], size: 0, mime, at: Date.now() };
      this.pending.set(uploadId, upload);
    }
    upload.chunks.push(data);
    upload.size += data.length;
    if (upload.size > MAX_BASE64) {
      this.pending.delete(uploadId);
      throw new UploadError("That image is too big to send (15 MB at most).");
    }
    if (!done) return { received: upload.size };
    this.pending.delete(uploadId);
    this.ensureDir();
    this.clean();
    const path = join(this.dir, `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${randomBytes(4).toString("hex")}.${ext}`);
    writeFileSync(path, Buffer.from(upload.chunks.join(""), "base64"), { mode: 0o600, flag: "wx" });
    return { path };
  }

  /** The folder, ours alone: in a shared /tmp someone else could have made it first, to read the images or swap in their own. */
  private ensureDir(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.dir);
    if (stat.isDirectory() && stat.uid === process.getuid?.() && (stat.mode & 0o022) === 0) return;
    this.dir = mkdtempSync(join(tmpdir(), "shepherd-uploads-"));
  }

  private expire(): void {
    for (const [id, upload] of this.pending) if (Date.now() - upload.at > PENDING_MS) this.pending.delete(id);
  }

  private clean(): void {
    try {
      for (const name of readdirSync(this.dir)) {
        const path = join(this.dir, name);
        if (Date.now() - statSync(path).mtimeMs > KEEP_MS) rmSync(path, { force: true });
      }
    } catch {
      // best effort
    }
  }
}
