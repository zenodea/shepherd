import { describe, expect, it } from "vitest";
import type { FileDiff } from "@shepherd/protocol";
import { changedRange, diffRows, langOf, pairChanges, spans, tokenize } from "./diff-rows";

const ts = langOf("src/a.ts");

describe("tokenize", () => {
  it("colours strings, numbers, keywords and a trailing comment, not comment markers inside strings", () => {
    const text = 'const url = "http://x" + 0x1f; // why';
    const kinds = tokenize(text, ts).map((t) => [text.slice(t.start, t.end), t.kind]);
    expect(kinds).toEqual([
      ["const", "keyword"],
      ['"http://x"', "string"],
      ["0x1f", "number"],
      ["// why", "comment"],
    ]);
  });

  it("knows comment lines and hash comments, and leaves unknown files plain", () => {
    expect(tokenize("  * a doc line", ts)).toEqual([{ start: 2, end: 14, kind: "comment" }]);
    expect(tokenize("x = 1  # set", langOf("a.py")).at(-1)).toMatchObject({ kind: "comment" });
    expect(langOf("README.md")).toBeNull();
    expect(tokenize("const x", null)).toEqual([]);
  });
});

describe("changedRange", () => {
  it("is the stretch between the common start and end", () => {
    expect(changedRange("const total = round(x)", "const total = roundHalfEven(x)")).toEqual({ before: [19, 19], after: [19, 27] });
    expect(changedRange("a = 1", "a = 2")).toEqual({ before: [4, 5], after: [4, 5] });
  });

  it("is null when most of the line changed", () => {
    expect(changedRange("return foo", "throw new Error('x')")).toBeNull();
  });
});

describe("pairChanges and spans", () => {
  it("marks the changed words of a line replaced one-for-one", () => {
    const lines = [
      { kind: "ctx" as const, text: "a", old: 1, new: 1 },
      { kind: "del" as const, text: "let n = 1;", old: 2 },
      { kind: "add" as const, text: "let n = 2;", new: 2 },
    ];
    const ranges = pairChanges(lines);
    expect([...ranges]).toEqual([
      [1, [8, 9]],
      [2, [8, 9]],
    ]);
    expect(spans("let n = 2;", tokenize("let n = 2;", ts), ranges.get(2)!)).toEqual([
      { text: "let", kind: "keyword", changed: false },
      { text: " n = ", kind: null, changed: false },
      { text: "2", kind: "number", changed: true },
      { text: ";", kind: null, changed: false },
    ]);
  });
});

describe("diffRows", () => {
  const diff: FileDiff = {
    path: "a.ts",
    additions: 1,
    deletions: 0,
    hunks: [
      { oldStart: 1, newStart: 1, lines: Array.from({ length: 12 }, (_, i) => ({ kind: "ctx" as const, text: `l${i}`, old: i + 1, new: i + 1 })).concat([{ kind: "add" as const, text: "x", new: 13 } as never]) },
      { oldStart: 40, newStart: 41, lines: [{ kind: "del", text: "y", old: 40 }] },
    ],
  };

  it("folds long unchanged stretches, marks where later hunks start, and opens a fold on request", () => {
    const rows = diffRows(diff, new Set());
    expect(rows.map((r) => r.kind)).toEqual(["fold", "line", "line", "line", "line", "hunk", "line"]);
    expect(rows[0]).toMatchObject({ kind: "fold", count: 9 });
    expect(rows[5]).toMatchObject({ kind: "hunk", line: 41 });
    expect(diffRows(diff, new Set([rows[0]!.key])).filter((r) => r.kind === "line")).toHaveLength(14);
  });
});
