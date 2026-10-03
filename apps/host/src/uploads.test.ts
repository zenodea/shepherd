import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Uploads } from "./uploads.ts";

describe("uploads", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const uploads = () => {
    const dir = mkdtempSync(join(tmpdir(), "shepherd-up-"));
    dirs.push(dir);
    return new Uploads(join(dir, "uploads"));
  };

  it("joins the chunks into a file only the host's user can read", () => {
    const u = uploads();
    const png = Buffer.from("\x89PNG fake image bytes");
    const base64 = png.toString("base64");
    expect(u.receive({ uploadId: "abcdefgh1", mime: "image/png", data: base64.slice(0, 8), done: false })).toEqual({ received: 8 });
    const result = u.receive({ uploadId: "abcdefgh1", mime: "image/png", data: base64.slice(8), done: true });
    if (!("path" in result)) throw new Error("not saved");
    expect(result.path.startsWith(u.dir)).toBe(true);
    expect(result.path.endsWith(".png")).toBe(true);
    expect(readFileSync(result.path)).toEqual(png);
    expect(statSync(result.path).mode & 0o777).toBe(0o600);
  });

  it("refuses what isn't an image, bad ids and bad data", () => {
    const u = uploads();
    expect(() => u.receive({ uploadId: "abcdefgh1", mime: "text/plain", data: "", done: true })).toThrow(/PNG/);
    expect(() => u.receive({ uploadId: "../../x", mime: "image/png", data: "", done: true })).toThrow(/id/);
    expect(() => u.receive({ uploadId: "abcdefgh1", mime: "image/png", data: "not base64!", done: true })).toThrow(/data/);
  });
});
