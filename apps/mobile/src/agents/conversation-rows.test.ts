import { describe, expect, it } from "vitest";
import type { ConversationEntry } from "@shepherd/protocol";
import { conversationRows, markdownBlocks } from "./conversation-rows";

describe("conversationRows", () => {
  it("puts each tool result with its call and keeps results whose call scrolled out of view", () => {
    const entries: ConversationEntry[] = [
      { id: 1, kind: "tool_result", callId: "a", ok: true, output: "older" },
      { id: 2, kind: "user", text: "go" },
      { id: 3, kind: "tool", callId: "b", name: "Bash", summary: "ls" },
      { id: 4, kind: "tool_result", callId: "b", ok: false, output: "nope" },
      { id: 5, kind: "tool", callId: "c", name: "Read", summary: "a.ts" },
    ];
    const rows = conversationRows(entries);
    expect(rows.map((r) => r.kind)).toEqual(["orphan_result", "message", "tool", "tool"]);
    expect(rows[2]).toMatchObject({ call: { callId: "b" }, result: { ok: false } });
    expect(rows[3]).toMatchObject({ call: { callId: "c" }, result: null });
  });
});

describe("markdownBlocks", () => {
  it("splits prose from fenced code", () => {
    expect(markdownBlocks("Run this:\n```bash\nnpm test\n```\nThen look.")).toEqual([
      { code: false, text: "Run this:" },
      { code: true, lang: "bash", text: "npm test" },
      { code: false, text: "Then look." },
    ]);
    expect(markdownBlocks("```\nunterminated")).toEqual([{ code: true, lang: "", text: "unterminated" }]);
  });
});

describe("markdownBlocks with longer code", () => {
  it("keeps every line of a fenced block", () => {
    expect(markdownBlocks("Look:\n\n```ts\nawait a();\nexpect(b).toBe(1);\n```\n\nDone.")).toEqual([
      { code: false, text: "Look:" },
      { code: true, lang: "ts", text: "await a();\nexpect(b).toBe(1);" },
      { code: false, text: "Done." },
    ]);
  });
});
