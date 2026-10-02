import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentInfo } from "@shepherd/protocol";
import { fakeAgent } from "../testing/fake-herdr.ts";
import { claudeParser, claudeProjectDir } from "./claude.ts";
import { codexParser } from "./codex.ts";
import { Conversations, conversationParams } from "./conversations.ts";
import { toolSummary } from "./entries.ts";
import { locateTranscript, type Roots } from "./locate.ts";
import { piParser, piSessionDir } from "./pi.ts";
import { TranscriptReader } from "./reader.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "shepherd-conv-"));
  dirs.push(d);
  return d;
};
const jsonl = (records: unknown[]) => records.map((r) => JSON.stringify(r)).join("\n") + "\n";
const at = "2026-10-02T12:00:00.000Z";

describe("Claude Code transcripts", () => {
  const parse = (records: Record<string, unknown>[]) => records.flatMap(claudeParser());

  it("reads prompts, replies, thinking and tool calls with their results", () => {
    const entries = parse([
      { type: "user", timestamp: at, message: { role: "user", content: "Fix the login test" } },
      { type: "assistant", timestamp: at, message: { content: [{ type: "thinking", thinking: "Look at the test first." }] } },
      { type: "assistant", timestamp: at, message: { content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "npm test", description: "Run tests" } }] } },
      { type: "user", timestamp: at, message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "1 failing" }], is_error: true }] } },
      { type: "assistant", timestamp: at, message: { content: [{ type: "text", text: "Fixed **it**." }] } },
    ]);
    expect(entries).toEqual([
      { kind: "user", text: "Fix the login test", at },
      { kind: "thinking", text: "Look at the test first.", at },
      { kind: "tool", callId: "toolu_1", name: "Bash", summary: "npm test", input: expect.stringContaining('"description": "Run tests"'), at },
      { kind: "tool_result", callId: "toolu_1", ok: false, output: "1 failing", at },
      { kind: "assistant", text: "Fixed **it**.", at },
    ]);
  });

  it("shows slash commands as typed and hides housekeeping", () => {
    const entries = parse([
      { type: "user", message: { content: "<command-name>/compact</command-name>\n<command-args>keep the plan</command-args>" } },
      { type: "user", message: { content: "<local-command-stdout>Compacted</local-command-stdout>" } },
      { type: "user", isMeta: true, message: { content: "Caveat: …" } },
      { type: "system", subtype: "compact_boundary" },
      { type: "user", isCompactSummary: true, message: { content: "Summary of the conversation…" } },
      { type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "subagent" }] } },
      { type: "permission-mode", permissionMode: "default" },
    ]);
    expect(entries.map((e) => ("text" in e ? `${e.kind}:${e.text}` : e.kind))).toEqual(["user:/compact keep the plan", "notice:Conversation compacted"]);
  });

  it("names project folders the way Claude Code does", () => {
    expect(claudeProjectDir("/Users/me/.herdr/my.site")).toBe("-Users-me--herdr-my-site");
  });
});

describe("Codex transcripts", () => {
  it("reads completed items once, and agent tools from function calls", () => {
    const entries = [
      { type: "session_meta", payload: { cwd: "/p", source: "cli" } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>…" }] } },
      { type: "event_msg", timestamp: at, payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "Add a flag" }] } } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "On it" }] } },
      { type: "event_msg", timestamp: at, payload: { type: "item_completed", item: { type: "AgentMessage", id: "msg_1", content: [{ type: "Text", text: "On it" }] } } },
      {
        type: "event_msg",
        timestamp: at,
        payload: { type: "item_completed", item: { type: "CommandExecution", id: "c1", command: ["/bin/zsh", "-lc", "rg flag"], status: "failed", exit_code: 1, aggregated_output: "" } },
      },
      { type: "response_item", timestamp: at, payload: { type: "function_call", call_id: "f1", name: "spawn_agent", arguments: '{"task":"review"}' } },
      { type: "response_item", timestamp: at, payload: { type: "function_call_output", call_id: "f1", output: "spawned" } },
    ].flatMap(codexParser());
    expect(entries.map((e) => e.kind)).toEqual(["user", "assistant", "tool", "tool_result", "tool", "tool_result"]);
    expect(entries[2]).toMatchObject({ name: "exec", summary: "rg flag" });
    expect(entries[3]).toMatchObject({ callId: "c1", ok: false });
    expect(entries[4]).toMatchObject({ name: "spawn_agent", summary: "review" });
  });
});

describe("pi transcripts", () => {
  it("reads messages, tool calls and results", () => {
    const entries = [
      { type: "session", cwd: "/p" },
      { type: "model_change" },
      { type: "message", timestamp: at, message: { role: "user", content: [{ type: "text", text: "Hi" }] } },
      { type: "message", timestamp: at, message: { role: "assistant", content: [{ type: "text", text: "Reading" }, { type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } }] } },
      { type: "message", timestamp: at, message: { role: "toolResult", toolCallId: "t1", isError: false, content: [{ type: "text", text: "contents" }] } },
      { type: "compaction", summary: "…" },
    ].flatMap(piParser());
    expect(entries.map((e) => e.kind)).toEqual(["user", "assistant", "tool", "tool_result", "notice"]);
    expect(entries[2]).toMatchObject({ callId: "t1", summary: "a.ts" });
    expect(piSessionDir("/Users/me/.superset/x")).toBe("--Users-me-.superset-x--");
  });
});

describe("tool summaries", () => {
  it("prefers what the call is about", () => {
    expect(toolSummary({ questions: [{ question: "Which colour?" }] })).toBe("Which colour?");
    expect(toolSummary({ command: ["git", "status"] })).toBe("git status");
    expect(toolSummary({ old_string: "a", new_string: "b" })).toBe("");
  });
});

describe("TranscriptReader", () => {
  const user = (text: string) => ({ type: "user", message: { content: text } });

  it("reads appended lines, waits for unfinished ones, and starts over when the file is replaced", () => {
    const path = join(tempDir(), "s.jsonl");
    writeFileSync(path, jsonl([user("one")]));
    const reader = new TranscriptReader(path, claudeParser);
    reader.refresh();
    expect(reader.page({ limit: 10 }).entries.map((e) => ("text" in e ? e.text : ""))).toEqual(["one"]);

    // Half a line: nothing new until the rest arrives. "é" splits across the write.
    const line = Buffer.from(JSON.stringify(user("twé")) + "\n");
    appendFileSync(path, line.subarray(0, line.length - 4));
    reader.refresh();
    expect(reader.page({ after: 0, limit: 10 }).entries).toEqual([]);
    appendFileSync(path, line.subarray(line.length - 4));
    reader.refresh();
    expect(reader.page({ after: 0, limit: 10 }).entries).toMatchObject([{ id: 1, text: "twé" }]);
    expect(reader.page({ before: 1, limit: 10 }).entries).toMatchObject([{ id: 0 }]);
    expect(reader.page({ limit: 10 })).toMatchObject({ first: 0, last: 1 });

    rmSync(path);
    writeFileSync(path, jsonl([user("fresh")]));
    reader.refresh();
    expect(reader.page({ limit: 10 }).entries).toMatchObject([{ id: 2, text: "fresh" }]);
  });
});

describe("finding transcripts", () => {
  const roots = (): Roots => {
    const root = tempDir();
    return { claude: join(root, "claude"), codex: join(root, "codex"), pi: join(root, "pi") };
  };
  const agent = (kind: string, extra: Partial<AgentInfo> = {}) => fakeAgent("w1:p1", "idle", { agent: kind, cwd: "/work/app", ...extra });
  const write = (path: string, records: unknown[], mtime: number) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, jsonl(records));
    utimesSync(path, mtime, mtime);
  };

  it("takes the newest Claude session for the pane's folder", () => {
    const r = roots();
    const dir = join(r.claude, claudeProjectDir("/work/app"));
    write(join(dir, "old.jsonl"), [], 1000);
    write(join(dir, "new.jsonl"), [], 2000);
    expect(locateTranscript(agent("claude"), "claude", r)).toBe(join(dir, "new.jsonl"));
    expect(locateTranscript(agent("claude", { agent_session: { agent: "claude", kind: "id", source: "x", value: "old" } }), "claude", r)).toBe(join(dir, "old.jsonl"));
  });

  it("skips subagent sessions for pi and Codex", () => {
    const r = roots();
    const pi = join(r.pi, piSessionDir("/work/app"));
    write(join(pi, "main.jsonl"), [{ type: "session", cwd: "/work/app" }], 1000);
    write(join(pi, "sub.jsonl"), [{ type: "session", cwd: "/work/app", parentSession: "main.jsonl" }], 2000);
    expect(locateTranscript(agent("pi"), "pi", r)).toBe(join(pi, "main.jsonl"));

    const now = new Date();
    const day = join(r.codex, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"));
    const t = now.getTime() / 1000;
    write(join(day, "rollout-a.jsonl"), [{ type: "session_meta", payload: { cwd: "/work/app", source: "cli" } }], t - 10);
    write(join(day, "rollout-b.jsonl"), [{ type: "session_meta", payload: { cwd: "/work/app", source: { subagent: {} } } }], t);
    write(join(day, "rollout-c.jsonl"), [{ type: "session_meta", payload: { cwd: "/elsewhere", source: "cli" } }], t);
    expect(locateTranscript(agent("codex"), "codex", r)).toBe(join(day, "rollout-a.jsonl"));
  });

  it("serves pages and explains when there's nothing to show", () => {
    const r = roots();
    const dir = join(r.claude, claudeProjectDir("/work/app"));
    write(join(dir, "s1.jsonl"), [{ type: "user", message: { content: "hello" } }], 1000);
    const conversations = new Conversations(r);
    expect(conversations.get(agent("claude"), { paneId: "w1:p1" })).toMatchObject({ available: true, agent: "claude", session: "s1", first: 0, last: 0 });
    expect(conversations.get(null, { paneId: "w1:p1" })).toMatchObject({ available: false });
    expect(conversations.get(agent("aider"), { paneId: "w1:p1" })).toMatchObject({ available: false, reason: expect.stringContaining("aider") });
    expect(conversations.get(agent("pi"), { paneId: "w1:p1" })).toMatchObject({ available: false });
  });

  it("validates the app's parameters", () => {
    const isPane = (v: unknown): v is string => typeof v === "string" && /^w\d+:p\d+$/.test(v);
    expect(conversationParams({ paneId: "w1:p1", after: 3 }, isPane)).toEqual({ paneId: "w1:p1", after: 3 });
    expect(conversationParams({ paneId: "../etc" }, isPane)).toBeNull();
    expect(conversationParams({ paneId: "w1:p1", limit: 1.5 }, isPane)).toBeNull();
  });
});
