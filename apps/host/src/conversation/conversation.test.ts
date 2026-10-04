import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentInfo } from "@shepherd/protocol";
import { fakeAgent } from "../testing/fake-herdr.ts";
import { Conversations, conversationParams } from "./conversations.ts";
import { toolSummary } from "./entries.ts";
import { TranscriptReader } from "./reader.ts";
import type { Vendor } from "./vendor.ts";
import { claude } from "./vendors/claude/index.ts";
import { claudeParser, claudeProjectDir } from "./vendors/claude/parser.ts";
import { codex } from "./vendors/codex/index.ts";
import { codexParser } from "./vendors/codex/parser.ts";
import { defaultVendors, type VendorHomes } from "./vendors/index.ts";
import { pi } from "./vendors/pi/index.ts";
import { piParser, piSessionDir } from "./vendors/pi/parser.ts";

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
const homes = (): VendorHomes => {
  const root = tempDir();
  return {
    claude: join(root, "claude"),
    codex: join(root, "codex"),
    pi: join(root, "pi"),
    gemini: join(root, "gemini"),
    opencode: { data: join(root, "opencode"), cache: join(root, "opencode-cache") },
    hermes: join(root, "hermes"),
  };
};
const claudeDir = (h: VendorHomes, cwd = "/work/app") => join(h.claude, "projects", claudeProjectDir(cwd));
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

  it("reads a line longer than one read", () => {
    const path = join(tempDir(), "s.jsonl");
    writeFileSync(path, jsonl([user("x".repeat(3 * 1024 * 1024)), user("after")]));
    const reader = new TranscriptReader(path, claudeParser);
    reader.refresh();
    expect(reader.page({ limit: 10 }).entries.map((e) => ("text" in e ? e.text.slice(0, 5) : ""))).toEqual(["xxxxx", "after"]);
  });
});

describe("finding transcripts", () => {
  const agent = (kind: string, extra: Partial<AgentInfo> = {}) => fakeAgent("w1:p1", "idle", { agent: kind, cwd: "/work/app", ...extra });
  const write = (path: string, records: unknown[], mtime: number) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, jsonl(records));
    utimesSync(path, mtime, mtime);
  };

  it("takes the newest Claude session for the pane's folder", () => {
    const h = homes();
    const dir = claudeDir(h);
    write(join(dir, "old.jsonl"), [], 1000);
    write(join(dir, "new.jsonl"), [], 2000);
    const vendor = claude({ home: h.claude });
    expect(vendor.locate(agent("claude"))).toBe(join(dir, "new.jsonl"));
    expect(vendor.locate(agent("claude", { agent_session: { agent: "claude", kind: "id", source: "x", value: "old" } }))).toBe(join(dir, "old.jsonl"));
  });

  it("skips subagent sessions for pi and Codex", () => {
    const h = homes();
    const piDir = join(h.pi, "sessions", piSessionDir("/work/app"));
    write(join(piDir, "main.jsonl"), [{ type: "session", cwd: "/work/app" }], 1000);
    write(join(piDir, "sub.jsonl"), [{ type: "session", cwd: "/work/app", parentSession: "main.jsonl" }], 2000);
    expect(pi({ home: h.pi }).locate(agent("pi"))).toBe(join(piDir, "main.jsonl"));

    const now = new Date();
    const day = join(h.codex, "sessions", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"));
    const t = now.getTime() / 1000;
    write(join(day, "rollout-a.jsonl"), [{ type: "session_meta", payload: { cwd: "/work/app", source: "cli" } }], t - 10);
    write(join(day, "rollout-b.jsonl"), [{ type: "session_meta", payload: { cwd: "/work/app", source: { subagent: {} } } }], t);
    write(join(day, "rollout-c.jsonl"), [{ type: "session_meta", payload: { cwd: "/elsewhere", source: "cli" } }], t);
    expect(codex({ home: h.codex }).locate(agent("codex"))).toBe(join(day, "rollout-a.jsonl"));
  });

  it("serves pages and explains when there's nothing to show", () => {
    const h = homes();
    const dir = claudeDir(h);
    write(join(dir, "s1.jsonl"), [{ type: "user", message: { content: "hello" } }], 1000);
    const conversations = new Conversations(defaultVendors(h));
    expect(conversations.get(agent("claude"), { paneId: "w1:p1" })).toMatchObject({ available: true, agent: "claude", session: expect.stringMatching(/^s1~/), first: 0, last: 0 });
    expect(conversations.get(null, { paneId: "w1:p1" })).toMatchObject({ available: false });
    expect(conversations.get(agent("aider"), { paneId: "w1:p1" })).toMatchObject({ available: false, reason: expect.stringContaining("aider") });
    // A fresh session that hasn't written anything yet: empty, so the app still offers the chat view.
    expect(conversations.get(agent("pi"), { paneId: "w1:p1" })).toMatchObject({ available: true, session: "", entries: [] });
  });

  it("names a new session when a transcript's reader is opened again, so the app starts over", () => {
    const dir = tempDir();
    const fake: Vendor = { id: "fake", locate: (a) => join(dir, `${a.pane_id.replace(":", "_")}.jsonl`), open: (t) => new TranscriptReader(t, claudeParser) };
    const pane = (i: number) => fakeAgent(`w${i}:p1`, "idle", { agent: "fake" });
    for (let i = 0; i < 40; i++) writeFileSync(fake.locate(pane(i))!, jsonl([{ type: "user", message: { content: "hi" } }]));
    const conversations = new Conversations([fake]);
    const session = () => {
      const result = conversations.get(pane(0), { paneId: "w0:p1", after: 0 });
      return result.available ? result.session : null;
    };
    const first = session();
    expect(session()).toBe(first);
    for (let i = 1; i < 40; i++) conversations.get(pane(i), { paneId: `w${i}:p1` });
    expect(session()).not.toBe(first);
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
    const { codexQueue, codexThreadId, queuedText } = await import("./vendors/codex/queue.ts");
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

    expect(codexQueue(path, thread).map((m) => m.text)).toEqual(["first\n[image]", "second"]);
    expect(codexQueue(join(tempDir(), "missing.sqlite"), thread)).toEqual([]);
    expect(codexThreadId(`/s/2026/10/02/rollout-2026-10-02T12-00-00-${thread}.jsonl`)).toBe(thread);
    expect(queuedText({ deep: { nested: [{ text: "a" }, { text: "b" }] } })).toBe("a\nb");
  });

  it("shows a queue only while the agent is busy", () => {
    const h = homes();
    const dir = claudeDir(h);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "s.jsonl"), jsonl([{ type: "queue-operation", operation: "enqueue", content: "next: the docs", timestamp: at }]));
    const conversations = new Conversations(defaultVendors(h));
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
    const h = homes();
    const dir = claudeDir(h);
    mkdirSync(dir, { recursive: true });
    const big = "Q".repeat(600_000);
    const first = JSON.stringify({ type: "user", message: { content: "look at this" } });
    const second = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: big } }] }] },
    });
    writeFileSync(join(dir, "s.jsonl"), `${first}\n${second}\n`);
    const conversations = new Conversations(defaultVendors(h));
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
    const { claudeParser } = await import("./vendors/claude/parser.ts");
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
    const h = homes();
    const dir = claudeDir(h);
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
    const conversations = new Conversations(defaultVendors(h));
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
    const h = homes();
    const dir = claudeDir(h);
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
    const vendor = claude({ home: h.claude, running: () => running, paneOf: (pid: number) => panes[pid] ?? null });
    const at = (pane: string) => vendor.locate(fakeAgent(pane, "idle", { agent: "claude", cwd: "/work/app" }));

    expect(at("w1:p1")).toBe(join(dir, "older.jsonl"));
    expect(at("w1:p2")).toBe(join(dir, "newest.jsonl"));
    // A session with no messages yet: nothing to show, not someone else's conversation.
    expect(at("w1:p4")).toBeNull();
    // No Claude running in the pane (it exited): the newest file no running Claude is on.
    expect(at("w1:p3")).toBe(join(dir, "abandoned.jsonl"));
  });
});

describe("subagents", () => {
  const working = (kind: string) => fakeAgent("w1:p1", "working", { agent: kind, cwd: "/work/app" });

  it("finds Claude subagents, links the call that started each, and reads their own conversation", () => {
    const h = homes();
    const dir = claudeDir(h);
    mkdirSync(join(dir, "main", "subagents"), { recursive: true });
    writeFileSync(
      join(dir, "main.jsonl"),
      jsonl([
        { type: "user", message: { content: "survey the formats" } },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_1", name: "Agent", input: { description: "Survey formats", prompt: "Look at…" } }] } },
      ]),
    );
    const sub = join(dir, "main", "subagents");
    writeFileSync(join(sub, "agent-a1.meta.json"), JSON.stringify({ agentType: "Explore", description: "Survey formats", toolUseId: "toolu_1", spawnDepth: 1 }));
    writeFileSync(
      join(sub, "agent-a1.jsonl"),
      jsonl([
        { type: "user", isSidechain: true, timestamp: at, message: { content: "Look at the transcript formats" } },
        { type: "assistant", isSidechain: true, message: { content: [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "a.jsonl" } }] } },
        { type: "assistant", isSidechain: true, message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t3", name: "SubagentHandback", input: { report: "done" } }] } },
      ]),
    );
    const conversations = new Conversations(defaultVendors(h));
    const main = conversations.get(working("claude"), { paneId: "w1:p1" });
    if (!main.available) throw new Error(main.reason);
    expect(main.subagents).toEqual([
      expect.objectContaining({ id: "a1", name: "Survey formats", kind: "Explore", depth: 1, status: "done", toolCalls: 2, startedAt: at, doing: null }),
    ]);
    expect(main.entries.find((e) => e.kind === "tool")).toMatchObject({ name: "Agent", subagent: "a1" });

    const own = conversations.get(working("claude"), { paneId: "w1:p1", subagent: "a1" });
    expect(own).toMatchObject({ available: true, session: expect.stringMatching(/^main\/a1~/), entries: [{ kind: "user", text: "Look at the transcript formats" }, { kind: "tool", name: "Read" }, { kind: "tool", name: "SubagentHandback" }] });
    expect(conversations.get(working("claude"), { paneId: "w1:p1", subagent: "nope" })).toMatchObject({ available: false });
  });

  it("finds the Codex subagents a thread spawned, not its helper threads, and shows only their own work", () => {
    const h = homes();
    const now = new Date();
    const day = join(h.codex, "sessions", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"));
    mkdirSync(day, { recursive: true });
    const meta = (id: string, source: unknown) => ({ type: "session_meta", payload: { id, cwd: "/work/app", source, timestamp: at } });
    const spawn = (parent: string, path: string, depth: number) => ({ subagent: { thread_spawn: { parent_thread_id: parent, depth, agent_path: path, agent_nickname: path.split("/").pop() === "review" ? "Hypatia" : "Franklin" } } });
    const done = (text: string) => ({ type: "event_msg", payload: { type: "item_completed", item: { type: "AgentMessage", id: text, content: [{ type: "output_text", text }] } } });
    writeFileSync(
      join(day, "rollout-root.jsonl"),
      jsonl([
        meta("root", "cli"),
        { type: "response_item", payload: { type: "function_call", name: "spawn_agent", call_id: "c1", arguments: JSON.stringify({ task_name: "review", message: "gAAAAABqvRtchufpHkCzgNVClgXSS4FmoJeAvMdm" }) } },
      ]),
    );
    writeFileSync(
      join(day, "rollout-child.jsonl"),
      jsonl([
        meta("child", spawn("root", "/root/review", 1)),
        done("inherited from the parent"),
        { type: "response_item", payload: { type: "agent_message", author: "/root", recipient: "/root/review", content: [{ type: "input_text", text: "Message Type: NEW_TASK\nTask name: /root/review\nPayload:\n" }] } },
        done("my own review"),
        { type: "event_msg", payload: { type: "task_complete" } },
      ]),
    );
    writeFileSync(join(day, "rollout-grandchild.jsonl"), jsonl([meta("grandchild", spawn("child", "/root/review/views", 2)), { type: "event_msg", payload: { type: "task_started" } }]));
    writeFileSync(join(day, "rollout-guardian.jsonl"), jsonl([meta("guardian", { subagent: { other: "guardian" } })]));

    const conversations = new Conversations(defaultVendors(h));
    const list = conversations.subagents(working("codex"));
    if (!list.available) throw new Error(list.reason);
    expect(list.subagents.map((s) => [s.id, s.name, s.kind, s.depth, s.status])).toEqual([
      ["child", "review", "Hypatia", 1, "done"],
      ["grandchild", "views", "Franklin", 2, "running"],
    ]);
    const main = conversations.get(working("codex"), { paneId: "w1:p1" });
    expect(main).toMatchObject({ entries: [{ kind: "tool", name: "spawn_agent", summary: "review", subagent: "child" }] });

    const own = conversations.get(working("codex"), { paneId: "w1:p1", subagent: "child" });
    expect(own).toMatchObject({
      entries: [
        { kind: "notice", text: "Task for review from the main agent" },
        { kind: "assistant", text: "my own review" },
      ],
    });
  });

  it("finds pi subagents by their parent session, names them by their task, and links the Agent call that reported their id", () => {
    const h = homes();
    const piDir = join(h.pi, "sessions", piSessionDir("/work/app"));
    mkdirSync(piDir, { recursive: true });
    const main = join(piDir, "main.jsonl");
    const message = (role: string, content: unknown, extra = {}) => ({ type: "message", timestamp: at, message: { role, content, ...extra } });
    writeFileSync(
      main,
      jsonl([
        { type: "session", id: "m", timestamp: "2026-10-02T11:00:00.000Z", cwd: "/work/app" },
        message("assistant", [{ type: "toolCall", id: "c1", name: "Agent", arguments: { description: "Review it", subagent_type: "reviewer", prompt: "Review…" } }]),
        message("toolResult", [{ type: "text", text: "Agent started in background.\nAgent ID: 3adf470b-a328-4e7" }], { toolCallId: "c1", toolName: "Agent" }),
        message("assistant", [{ type: "toolCall", id: "c2", name: "Agent", arguments: { description: "Other", subagent_type: "worker", prompt: "…" } }]),
        message("toolResult", [{ type: "text", text: "Agent started in background.\nAgent ID: 99999999-0000-000" }], { toolCallId: "c2", toolName: "Agent" }),
      ]),
    );
    writeFileSync(
      join(piDir, "child.jsonl"),
      jsonl([
        { type: "session", id: "01a1-child", timestamp: at, cwd: "/work/app", parentSession: main },
        { type: "session_info", name: "reviewer#3adf470b" },
        message("user", [{ type: "text", text: "Task: review the vendor blocks\nDetails…" }]),
        message("assistant", [{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a.py" } }]),
        message("assistant", [{ type: "text", text: "Looks good." }], { stopReason: "stop" }),
      ]),
    );
    writeFileSync(join(piDir, "unrelated.jsonl"), jsonl([{ type: "session", id: "u", timestamp: at, cwd: "/work/app", parentSession: join(piDir, "other.jsonl") }]));

    const conversations = new Conversations(defaultVendors(h));
    const page = conversations.get(working("pi"), { paneId: "w1:p1" });
    if (!page.available) throw new Error(page.reason);
    expect(page.subagents).toEqual([expect.objectContaining({ id: "01a1-child", name: "review the vendor blocks", kind: "reviewer", depth: 1, status: "done", startedAt: at })]);
    expect(page.entries.filter((e) => e.kind === "tool").map((e) => (e.kind === "tool" ? e.subagent : null))).toEqual(["01a1-child", undefined]);
    const own = conversations.get(working("pi"), { paneId: "w1:p1", subagent: "01a1-child" });
    expect(own).toMatchObject({ available: true, entries: [{ kind: "user" }, { kind: "tool", name: "read" }, { kind: "assistant", text: "Looks good." }] });
  });

  it("leaves subagents out for vendors that don't record them", () => {
    const h = homes();
    const piDir = join(h.pi, "sessions", piSessionDir("/work/app"));
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "s.jsonl"), jsonl([{ type: "session", cwd: "/work/app" }]));
    const { subagents: _, ...withoutSubagents } = pi({ home: h.pi });
    const conversations = new Conversations([withoutSubagents as Vendor]);
    expect(conversations.get(working("pi"), { paneId: "w1:p1" })).not.toHaveProperty("subagents");
    expect(conversations.subagents(working("pi"))).toMatchObject({ available: false });
  });
});
