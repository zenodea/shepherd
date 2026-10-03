import { describe, expect, it } from "vitest";
import type { ConversationEntry } from "@shepherd/protocol";
import { conversationRows, countUserMessages, markdownBlocks, queuedRows, userMessageIndex, type Row } from "./conversation-rows";

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

describe("jumping between your messages", () => {
  // Inverted like the list: index 0 is the newest.
  const entries: ConversationEntry[] = [
    { id: 1, kind: "user", text: "first" },
    { id: 2, kind: "assistant", text: "a" },
    { id: 3, kind: "user", text: "second" },
    { id: 4, kind: "assistant", text: "b" },
    { id: 5, kind: "assistant", text: "c" },
    { id: 6, kind: "user", text: "third" },
    { id: 7, kind: "assistant", text: "d" },
  ];
  const rows = conversationRows(entries).reverse();
  const at = (i: number | null) => (i === null ? null : (rows[i] as Extract<Row, { kind: "message" }>).entry.id);

  it("goes to the nearest of your messages beyond what's on screen", () => {
    // On screen: entries 7 and 6 (indexes 0–1).
    expect(at(userMessageIndex(rows, { newest: 0, oldest: 1 }, "older"))).toBe(3);
    // On screen: entries 2–1 (the oldest two).
    expect(userMessageIndex(rows, { newest: 5, oldest: 6 }, "older")).toBeNull();
    expect(at(userMessageIndex(rows, { newest: 5, oldest: 6 }, "newer"))).toBe(3);
    expect(userMessageIndex(rows, { newest: 0, oldest: 1 }, "newer")).toBeNull();
    expect(countUserMessages(rows)).toBe(3);
  });

  it("puts queued messages below the newest message, newest queued at the very bottom", () => {
    const queued = queuedRows([{ text: "then the docs" }, { text: "then the tests" }]);
    expect(queued.map((r) => (r.kind === "queued" ? r.message.text : ""))).toEqual(["then the tests", "then the docs"]);
  });
});
