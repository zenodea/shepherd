import { describe, expect, it } from "vitest";
import type { ConversationEntry } from "@shepherd/protocol";
import { cacheName, SAVED_ENTRIES, trimChat } from "./offline-cache";

describe("cacheName", () => {
  it("makes a file name from a computer and what's kept, safe for pane ids and subagents", () => {
    expect(cacheName("h1", "agents")).toBe("h1__agents.json");
    expect(cacheName("h1", "chat-w1:p3/a1")).toBe("h1__chat-w1%3ap3%2fa1.json");
    expect(cacheName("h1", "chat-w1:p3/a1").startsWith(cacheName("h1", ""))).toBe(true);
    expect(cacheName("h10", "agents").startsWith(cacheName("h1", ""))).toBe(false);
  });
});

describe("trimChat", () => {
  it("keeps the latest messages and when it was saved, and where the history starts", () => {
    const entries = Array.from({ length: SAVED_ENTRIES + 50 }, (_, id) => ({ id, kind: "user", text: `m${id}` }) as ConversationEntry);
    const saved = trimChat({ agent: "claude", session: "s~1", entries, first: 0, subagents: [] }, 123);
    expect(saved.entries).toHaveLength(SAVED_ENTRIES);
    expect(saved.entries[0]!.id).toBe(50);
    expect(saved).toMatchObject({ first: 0, savedAt: 123, session: "s~1" });
  });
});
