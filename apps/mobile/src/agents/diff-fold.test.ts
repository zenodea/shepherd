import { describe, expect, it } from "vitest";
import type { DiffLine } from "@shepherd/protocol";
import { foldContext } from "./diff-fold";

const ctx = (n: number): DiffLine[] => Array.from({ length: n }, (_, i) => ({ kind: "ctx", text: `c${i}` }));
const add = (text: string): DiffLine => ({ kind: "add", text });

describe("foldContext", () => {
  it("keeps a few unchanged lines around each change and folds the rest", () => {
    const pieces = foldContext([...ctx(10), add("x"), ...ctx(20), add("y"), ...ctx(10)]);
    expect(pieces.map((p) => `${p.kind}:${p.lines.length}`)).toEqual(["fold:7", "lines:7", "fold:14", "lines:7", "fold:7"]);
  });

  it("doesn't fold a stretch that's barely longer than what it keeps", () => {
    expect(foldContext([add("x"), ...ctx(7), add("y")]).map((p) => p.kind)).toEqual(["lines"]);
  });
});
