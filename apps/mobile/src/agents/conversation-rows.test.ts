import { describe, expect, it } from "vitest";
import type { ConversationEntry } from "@shepherd/protocol";
import { contextLabel, conversationRows, countUserMessages, groupActivity, queuedRows, userMessageIndex, type Row } from "./conversation-rows";

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

describe("folding tool calls", () => {
  const tool = (id: number, name: string, ok = true): ConversationEntry[] => [
    { id, kind: "tool", callId: `c${id}`, name, summary: "x" },
    { id: id + 0.5, kind: "tool_result", callId: `c${id}`, ok, output: "" },
  ];

  it("folds a run between messages, counting what it did, and leaves the latest run open", () => {
    const entries: ConversationEntry[] = [
      { id: 0, kind: "user", text: "go" },
      ...tool(1, "Read"),
      { id: 2, kind: "thinking", text: "hmm" },
      ...tool(3, "Read"),
      ...tool(4, "Edit", false),
      { id: 5, kind: "assistant", text: "done that" },
      ...tool(6, "Bash"),
      ...tool(7, "Bash"),
      ...tool(8, "Bash"),
    ];
    const rows = groupActivity(conversationRows(entries));
    expect(rows.map((r) => r.kind)).toEqual(["message", "group", "message", "tool", "tool", "tool"]);
    expect(rows[1]).toMatchObject({ tools: 3, names: [["Read", 2], ["Edit", 1]], failed: true });
  });

  it("leaves short runs alone", () => {
    const rows = groupActivity(conversationRows([...tool(1, "Read"), ...tool(2, "Read"), { id: 3, kind: "assistant", text: "ok" }]));
    expect(rows.map((r) => r.kind)).toEqual(["tool", "tool", "message"]);
  });
});

describe("contextLabel", () => {
  it("shows a percentage when the window is known, tokens otherwise", () => {
    expect(contextLabel({ used: 125_278, window: 258_400 })).toEqual({ text: "48% context", high: false });
    expect(contextLabel({ used: 230_000, window: 258_400 })).toEqual({ text: "89% context", high: true });
    expect(contextLabel({ used: 125_400, window: null })).toEqual({ text: "125k context", high: false });
    expect(contextLabel({ used: 1_250_000, window: null })?.text).toBe("1.3M context");
    expect(contextLabel(null)).toBeNull();
  });
});

describe("subagent calls", () => {
  it("stay out of folded runs of tool calls", () => {
    const tool = (id: number, subagent?: string) => ({ id, kind: "tool" as const, callId: `c${id}`, name: subagent ? "Agent" : "Read", summary: "", ...(subagent ? { subagent } : {}) });
    const rows = groupActivity(conversationRows([tool(1), tool(2), tool(3), tool(4, "a1"), tool(5), tool(6), tool(7)]));
    expect(rows.map((r) => (r.kind === "group" ? `group:${r.tools}` : r.kind === "tool" ? r.call.name : r.kind))).toEqual(["group:3", "Agent", "Read", "Read", "Read"]);
  });
});
