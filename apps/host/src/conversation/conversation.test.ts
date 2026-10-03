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

describe("agents' message queues", () => {
  it("replays Claude's queue: enqueue, dequeue from the front, remove what it took mid-turn", () => {
    const parse = claudeParser();
    const q = (operation: string, content?: string) => parse({ type: "queue-operation", operation, timestamp: at, ...(content ? { content } : {}) });
    q("enqueue", "<task-notification>internal</task-notification>");
    q("enqueue", "also update the docs");
    q("enqueue", "and run the tests");
    expect(parse.queued!().map((m) => m.text)).toEqual(["also update the docs", "and run the tests"]);
    // The hidden one is first in line, so a dequeue takes it, not "also update the docs".
    q("dequeue");
    expect(parse.queued!().map((m) => m.text)).toEqual(["also update the docs", "and run the tests"]);
    q("remove", "and run the tests");
    expect(parse.queued!()).toEqual([{ text: "also update the docs", at }]);
  });

  it("reads Codex's queue database by thread, whatever shape the message has", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { CodexQueue, codexThreadId, queuedText } = await import("./codex-queue.ts");
    const path = join(tempDir(), "queue_1.sqlite");
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE queued_items (id TEXT PRIMARY KEY NOT NULL, thread_id TEXT NOT NULL, payload_json TEXT NOT NULL,
      queue_order INTEGER NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL)`);
    const insert = db.prepare("INSERT INTO queued_items VALUES (?, ?, ?, ?, ?, ?)");
    const thread = "019a2b3c-4d5e-7f80-9a1b-2c3d4e5f6a7b";
    insert.run("b", thread, JSON.stringify({ items: [{ type: "text", text: "second" }] }), 2, 1000, 1000);
    insert.run("a", thread, JSON.stringify({ input: [{ type: "text", text: "first" }, { type: "localImage", path: "/x.png" }] }), 1, 1000, 1000);
    insert.run("c", "another-thread", JSON.stringify({ text: "not this one" }), 1, 1000, 1000);
    db.close();

    const queue = new CodexQueue(path);
    expect(queue.read(thread).map((m) => m.text)).toEqual(["first\n[image]", "second"]);
    expect(new CodexQueue(join(tempDir(), "missing.sqlite")).read(thread)).toEqual([]);
    expect(codexThreadId(`/s/2026/10/02/rollout-2026-10-02T12-00-00-${thread}.jsonl`)).toBe(thread);
    expect(queuedText({ deep: { nested: [{ text: "a" }, { text: "b" }] } })).toBe("a\nb");
    queue.close();
  });

  it("shows a queue only while the agent is busy", () => {
    const r: Roots = { claude: join(tempDir(), "claude"), codex: join(tempDir(), "codex", "sessions"), pi: join(tempDir(), "pi") };
    const dir = join(r.claude, claudeProjectDir("/work/app"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "s.jsonl"), jsonl([{ type: "queue-operation", operation: "enqueue", content: "next: the docs", timestamp: at }]));
    const conversations = new Conversations(r);
    const claude = (status: AgentInfo["agent_status"]) => fakeAgent("w1:p1", status, { agent: "claude", cwd: "/work/app" });
    expect(conversations.get(claude("working"), { paneId: "w1:p1" })).toMatchObject({ queued: [{ text: "next: the docs" }] });
    expect(conversations.get(claude("idle"), { paneId: "w1:p1" })).toMatchObject({ queued: [] });
  });
});

describe("context usage", () => {
  it("takes the latest usage each agent records", () => {
    const claude = claudeParser();
    claude({ type: "assistant", message: { content: [], usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 99_000, output_tokens: 50 } } });
    expect(claude.context!()).toEqual({ used: 100_002, window: null });

    const codex = codexParser();
    codex({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 125_278 }, model_context_window: 258_400 } } });
    expect(codex.context!()).toEqual({ used: 125_278, window: 258_400 });

    const pi = piParser();
    pi({ type: "message", message: { role: "assistant", content: [], usage: { input: 2, cacheRead: 400_000, cacheWrite: 1_000, output: 10 } } });
    expect(pi.context!()).toEqual({ used: 401_002, window: null });
  });
});

describe("images", () => {
  it("finds images in each agent's records", async () => {
    const { imagesIn } = await import("./images.ts");
    expect(imagesIn({ content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } }] })).toEqual([{ mime: "image/png", data: "AAA" }]);
    expect(imagesIn({ content: [{ type: "image", data: "BBB", mimeType: "image/jpeg" }] })).toEqual([{ mime: "image/jpeg", data: "BBB" }]);
    expect(imagesIn({ content: [{ type: "input_image", image_url: "data:image/webp;base64,CCC" }] })).toEqual([{ mime: "image/webp", data: "CCC" }]);
  });

  it("references images by where they are, and serves them in chunks", () => {
    const r: Roots = { claude: join(tempDir(), "claude"), codex: join(tempDir(), "codex", "sessions"), pi: join(tempDir(), "pi") };
    const dir = join(r.claude, claudeProjectDir("/work/app"));
    mkdirSync(dir, { recursive: true });
    const big = "Q".repeat(600_000);
    const first = JSON.stringify({ type: "user", message: { content: "look at this" } });
    const second = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: big } }] }] },
    });
    writeFileSync(join(dir, "s.jsonl"), `${first}\n${second}\n`);
    const conversations = new Conversations(r);
    const agent = fakeAgent("w1:p1", "working", { agent: "claude", cwd: "/work/app" });
    const result = conversations.get(agent, { paneId: "w1:p1" });
    if (!result.available) throw new Error("unavailable");
    const withImage = result.entries.find((e) => e.images?.length)!;
    expect(withImage).toMatchObject({ kind: "tool_result", images: [{ id: `${first.length + 1}:0`, mime: "image/png", bytes: 450_000 }] });

    let data = "";
    for (let from = 0; ; ) {
      const chunk = conversations.image(agent, { paneId: "w1:p1", id: withImage.images![0]!.id, from });
      if (!chunk.available) throw new Error(chunk.reason);
      data += chunk.data;
      from += chunk.data.length;
      if (from >= chunk.total) break;
    }
    expect(data).toBe(big);
    expect(conversations.image(agent, { paneId: "w1:p1", id: "0:5" })).toMatchObject({ available: false });
  });

  it("validates image requests", async () => {
    const { imageParams } = await import("./conversations.ts");
    const isPane = (v: unknown): v is string => v === "w1:p1";
    expect(imageParams({ paneId: "w1:p1", id: "123:0", from: 10 }, isPane)).toEqual({ paneId: "w1:p1", id: "123:0", from: 10 });
    expect(imageParams({ paneId: "w1:p1", id: "../etc" }, isPane)).toBeNull();
    expect(imageParams({ paneId: "w1:p1", id: "1:0", from: -1 }, isPane)).toBeNull();
  });
});

describe("claude messages taken in mid-turn", () => {
  it("shows a queued message once Claude takes it in, and only yours", async () => {
    const { claudeParser } = await import("./claude.ts");
    const parse = claudeParser();
    const text = "also check the tests";
    expect(parse({ type: "queue-operation", operation: "enqueue", timestamp: "t1", content: text })).toEqual([]);
    expect(parse.queued?.()).toEqual([{ text, at: "t1" }]);
    parse({ type: "queue-operation", operation: "remove", timestamp: "t2", content: text, reason: "absorbed_mid_turn" });
    expect(parse.queued?.()).toEqual([]);
    const attachment = (origin: object, prompt: unknown) => ({ type: "attachment", timestamp: "t2", attachment: { type: "queued_command", prompt, commandMode: "prompt", origin } });
    expect(parse(attachment({ kind: "human" }, text))).toEqual([{ kind: "user", text, at: "t2" }]);
    expect(parse(attachment({ kind: "human" }, [{ type: "text", text: "look" }, { type: "image", source: {} }]))).toEqual([{ kind: "user", text: "look\n[image]", at: "t2" }]);
    expect(parse(attachment({ kind: "task-notification" }, "<task-notification>done</task-notification>"))).toEqual([]);
    expect(parse(attachment({ kind: "peer" }, "a subagent's report"))).toEqual([]);
  });
});

describe("image list", () => {
  it("groups every image under the message of yours it came after, newest first", () => {
    const r: Roots = { claude: join(tempDir(), "claude"), codex: join(tempDir(), "codex", "sessions"), pi: join(tempDir(), "pi") };
    const dir = join(r.claude, claudeProjectDir("/work/app"));
    mkdirSync(dir, { recursive: true });
    const img = (data: string) => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });
    const lines = [
      { type: "user", message: { content: [img("AAAA"), { type: "text", text: "what's wrong here?" }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [img("BBBB")] }] } },
      { type: "user", message: { content: "no images after this one" } },
      { type: "user", message: { content: "now check the page" } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: [img("CCCC"), img("DDDD")] }] } },
    ];
    writeFileSync(join(dir, "s.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const conversations = new Conversations(r);
    const result = conversations.images(fakeAgent("w1:p1", "working", { agent: "claude", cwd: "/work/app" }));
    if (!result.available) throw new Error(result.reason);
    expect(result.groups.map((g) => [g.message, g.images.length])).toEqual([
      ["now check the page", 2],
      ["what's wrong here?", 2],
    ]);
    expect(conversations.images(null)).toMatchObject({ available: false });
  });
});

describe("which Claude session a pane is on", () => {
  it("follows the Claude running in each pane, not the newest file in the folder", async () => {
    const { locateTranscript } = await import("./locate.ts");
    const r: Roots = { claude: join(tempDir(), "claude"), codex: join(tempDir(), "codex", "sessions"), pi: join(tempDir(), "pi") };
    const dir = join(r.claude, claudeProjectDir("/work/app"));
    mkdirSync(dir, { recursive: true });
    const write = (id: string, mtime: number) => {
      writeFileSync(join(dir, `${id}.jsonl`), `${JSON.stringify({ type: "user", message: { content: id } })}\n`);
      utimesSync(join(dir, `${id}.jsonl`), mtime, mtime);
    };
    write("older", 1000);
    write("newest", 2000);
    write("abandoned", 1500);
    const running = [
      { pid: 11, sessionId: "older", cwd: "/work/app", startedAt: 1 },
      { pid: 22, sessionId: "newest", cwd: "/work/app", startedAt: 2 },
      { pid: 33, sessionId: "fresh", cwd: "/work/app", startedAt: 3 },
    ];
    const panes: Record<number, string> = { 11: "w1:p1", 22: "w1:p2", 33: "w1:p4" };
    const processes = { claude: () => running, paneOf: (pid: number) => panes[pid] ?? null };
    const at = (pane: string) => locateTranscript(fakeAgent(pane, "idle", { agent: "claude", cwd: "/work/app" }), "claude", r, processes);

    expect(at("w1:p1")).toBe(join(dir, "older.jsonl"));
    expect(at("w1:p2")).toBe(join(dir, "newest.jsonl"));
    // A session with no messages yet: nothing to show, not someone else's conversation.
    expect(at("w1:p4")).toBeNull();
    // No Claude running in the pane (it exited): the newest file no running Claude is on.
    expect(at("w1:p3")).toBe(join(dir, "abandoned.jsonl"));
  });
});
