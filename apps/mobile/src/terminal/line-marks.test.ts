import { describe, expect, it } from "vitest";
import type { StyledLine } from "@shepherd/protocol";
import { findLinks, findMatches, segment } from "./line-marks";

const values = (text: string) => findLinks(text).map((m) => [m.link!.kind, m.link!.value]);

describe("findLinks", () => {
  it("finds URLs without trailing punctuation", () => {
    expect(values("see https://example.com/a?b=1, then")).toEqual([["url", "https://example.com/a?b=1"]]);
    expect(values("(https://x.dev/docs).")).toEqual([["url", "https://x.dev/docs"]]);
  });

  it("finds file paths, with line numbers", () => {
    expect(values("● Read(src/auth/login.test.ts)")).toEqual([["path", "src/auth/login.test.ts"]]);
    expect(values("error at ./lib/a.js:12:4 here")).toEqual([["path", "./lib/a.js:12:4"]]);
    expect(values("cd /Users/demo/code/api")).toEqual([["path", "/Users/demo/code/api"]]);
    expect(values("open ~/work/notes.md.")).toEqual([["path", "~/work/notes.md"]]);
  });

  it("leaves ordinary words alone", () => {
    expect(values("and/or read it, 1/2 done, v1.2")).toEqual([]);
    expect(values("GET /api 200")).toEqual([]);
  });

  it("doesn't count a URL's path as a file", () => {
    expect(values("https://github.com/zenodea/shepherd/blob/main/README.md")).toEqual([
      ["url", "https://github.com/zenodea/shepherd/blob/main/README.md"],
    ]);
  });
});

describe("segment", () => {
  const line: StyledLine = [
    ["● ", "#0f0", null, 0],
    ["Read(src/a.ts)", null, null, 1],
  ];

  it("cuts spans at mark edges and keeps their style", () => {
    const text = line.map((s) => s[0]).join("");
    const segs = segment(line, [...findLinks(text), ...findMatches(text, "read", true)]);
    expect(segs.map((s) => [s.span[0], s.span[3], s.link?.value ?? null, s.match ?? null])).toEqual([
      ["● ", 0, null, null],
      ["Read", 1, null, "current"],
      ["(", 1, null, null],
      ["src/a.ts", 1, "src/a.ts", null],
      [")", 1, null, null],
    ]);
  });

  it("passes plain lines through", () => {
    expect(segment(line, []).map((s) => s.span)).toEqual(line);
  });
});
