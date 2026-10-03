import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentInfo, ConversationEntry } from "@shepherd/protocol";
import { fakeAgent } from "../testing/fake-herdr.ts";
import { Conversations } from "./conversations.ts";
import { defaultVendors, type VendorHomes } from "./vendors/index.ts";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function homes(): VendorHomes {
  const root = mkdtempSync(join(tmpdir(), "shepherd-vendors-"));
  dirs.push(root);
  return {
    claude: join(root, "claude"),
    codex: join(root, "codex"),
    pi: join(root, "pi"),
    gemini: join(root, "gemini"),
    opencode: { data: join(root, "opencode"), cache: join(root, "opencode-cache") },
    hermes: join(root, "hermes"),
  };
}

const agent = (kind: string, status: AgentInfo["agent_status"] = "idle") => fakeAgent("w1:p1", status, { agent: kind, cwd: "/work/app" });
const shape = (entries: ConversationEntry[]) =>
  entries.map((e) => (e.kind === "tool" ? `tool:${e.name}${e.diff ? `(+${e.diff.additions}-${e.diff.deletions})` : ""}` : e.kind === "tool_result" ? `result:${e.ok}` : `${e.kind}:${"text" in e ? e.text.slice(0, 24) : ""}`));

function sqlite(path: string, schema: string, rows: [string, unknown[]][]) {
  mkdirSync(join(path, ".."), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(schema);
  for (const [sql, params] of rows) db.prepare(sql).run(...(params as never[]));
  db.close();
}

describe("Gemini CLI", () => {
  it("reads the session file of the pane's project, once per message even when rewritten", () => {
    const h = homes();
    const chats = join(h.gemini, "tmp", "app", "chats");
    mkdirSync(chats, { recursive: true });
    writeFileSync(join(h.gemini, "projects.json"), JSON.stringify({ projects: { "/work/app": "app" } }));
    const message = { id: "b7e2", timestamp: "2026-10-04T09:12:14.880Z", type: "gemini", content: "I'll run the tests.", thoughts: [{ subject: "Planning", description: "Run npm test." }], tokens: { input: 8123 }, model: "gemini-2.5-pro" };
    const lines = [
      { sessionId: "3f2a9c1e", startTime: "2026-10-04T09:12:03.120Z", kind: "main" },
      { id: "a1d0", timestamp: "2026-10-04T09:12:10.004Z", type: "user", content: [{ text: "Run the tests and fix the typo" }] },
      { $set: { lastUpdated: "2026-10-04T09:12:10.005Z" } },
      message,
      {
        ...message,
        toolCalls: [
          { id: "call_1", name: "run_shell_command", displayName: "Shell", args: { command: "npm test" }, status: "success", resultDisplay: "1 failing" },
          {
            id: "call_2",
            name: "replace",
            displayName: "Edit",
            args: { file_path: "/work/app/greet.ts", old_string: "'Helo'", new_string: "'Hello'" },
            status: "success",
            resultDisplay: { fileDiff: "--- greet.ts\tCurrent\n+++ greet.ts\tProposed\n@@ -1,1 +1,1 @@\n-'Helo'\n+'Hello'\n", filePath: "/work/app/greet.ts" },
          },
        ],
      },
      { id: "c903", type: "user", timestamp: "2026-10-04T09:12:19.100Z", content: [{ functionResponse: { id: "call_1", name: "run_shell_command", response: { output: "1 failing" } } }] },
      { id: "d44f", timestamp: "2026-10-04T09:12:23.400Z", type: "gemini", content: "Fixed the typo.", tokens: { input: 9012 } },
    ];
    writeFileSync(join(chats, "session-2026-10-04T09-12-3f2a9c1e.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

    const result = new Conversations(defaultVendors(h)).get(agent("gemini"), { paneId: "w1:p1" });
    if (!result.available) throw new Error(result.reason);
    expect(shape(result.entries)).toEqual(["user:Run the tests and fix th", "thinking:Planning: Run npm test.", "assistant:I'll run the tests.", "tool:Shell", "result:true", "tool:Edit(+1-1)", "result:true", "assistant:Fixed the typo."]);
    expect(result.context).toEqual({ used: 9012, window: 1_048_576 });
  });
});

describe("OpenCode", () => {
  it("reads the pane's session from OpenCode's database, with its queue and subagents", () => {
    const h = homes();
    const db = join(h.opencode.data, "opencode.db");
    const msg = (id: string, session: string, created: number, data: object) => ["INSERT INTO message VALUES (?, ?, ?, ?, ?)", [id, session, created, created, JSON.stringify(data)]] as [string, unknown[]];
    const part = (id: string, message: string, session: string, data: object) => ["INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)", [id, message, session, 1, 1, JSON.stringify(data)]] as [string, unknown[]];
    sqlite(
      db,
      `CREATE TABLE session (id TEXT, parent_id TEXT, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER);
       CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
       CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);`,
      [
        ["INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)", ["ses_main", null, "/work/app", "Fix failing test", 1000, Date.now()]],
        ["INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)", ["ses_child", "ses_main", "/work/app", "Find callers (@explore subagent)", 1500, Date.now()]],
        msg("msg_1", "ses_main", 1000, { role: "user", time: { created: 1000 } }),
        part("prt_1", "msg_1", "ses_main", { type: "text", text: "tests fail, fix them" }),
        part("prt_2", "msg_1", "ses_main", { type: "file", mime: "image/png", url: "data:image/png;base64,iVBORw0KGgo=" }),
        part("prt_3", "msg_1", "ses_main", { type: "text", text: "injected file text", synthetic: true }),
        msg("msg_2", "ses_main", 1100, { role: "assistant", time: { created: 1100 }, providerID: "anthropic", modelID: "claude", tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 900, write: 0 } } }),
        part("prt_4", "msg_2", "ses_main", { type: "reasoning", text: "Run the tests first.", time: { start: 1, end: 2 } }),
        part("prt_5", "msg_2", "ses_main", { type: "tool", callID: "call_bash", tool: "bash", state: { status: "completed", input: { command: "npm test" }, output: "1 failing" } }),
        part("prt_6", "msg_2", "ses_main", { type: "tool", callID: "call_task", tool: "task", state: { status: "running", input: { description: "Find callers" }, metadata: { sessionId: "ses_child" } } }),
        part("prt_7", "msg_2", "ses_main", {
          type: "tool",
          callID: "call_edit",
          tool: "edit",
          state: { status: "completed", input: { filePath: "/work/app/sum.ts" }, output: "Edit applied.", metadata: { filediff: { patch: "@@ -1 +1 @@\n-a-b\n+a+b\n" } } },
        }),
        part("prt_8", "msg_2", "ses_main", { type: "text", text: "", time: { start: 3 } }),
        msg("msg_3", "ses_main", 1200, { role: "user", time: { created: 1200 } }),
        part("prt_9", "msg_3", "ses_main", { type: "text", text: "also update the docs" }),
        msg("msg_c1", "ses_child", 1500, { role: "user", time: { created: 1500 } }),
        part("prt_c1", "msg_c1", "ses_child", { type: "text", text: "Find callers of sum()" }),
      ],
    );
    const conversations = new Conversations(defaultVendors(h));
    const result = conversations.get(agent("opencode", "working"), { paneId: "w1:p1" });
    if (!result.available) throw new Error(result.reason);
    expect(shape(result.entries)).toEqual(["user:tests fail, fix them", "thinking:Run the tests first.", "tool:bash", "result:true", "tool:task", "tool:edit(+1-1)", "result:true"]);
    expect(result.entries[0]).toMatchObject({ images: [{ id: "prt_2", mime: "image/png" }] });
    expect(result.queued).toEqual([{ text: "also update the docs", at: new Date(1200).toISOString() }]);
    expect(result.context).toEqual({ used: 1010, window: null });
    expect(result.subagents).toEqual([expect.objectContaining({ id: "ses_child", name: "Find callers", kind: "explore", status: "running" })]);
    expect(result.entries.find((e) => e.kind === "tool" && e.name === "task")).toMatchObject({ subagent: "ses_child" });
    expect(conversations.image(agent("opencode"), { paneId: "w1:p1", id: "prt_2" })).toMatchObject({ available: true, mime: "image/png", data: "iVBORw0KGgo=" });
    expect(conversations.get(agent("opencode"), { paneId: "w1:p1", subagent: "ses_child" })).toMatchObject({ entries: [{ kind: "user", text: "Find callers of sum()" }] });
  });
});

describe("Hermes", () => {
  it("reads the session for the pane's folder from Hermes's database", () => {
    const h = homes();
    const row = (id: number, session: string, role: string, extra: Record<string, unknown>) =>
      [
        "INSERT INTO messages (id, session_id, role, content, tool_call_id, tool_calls, tool_name, reasoning, timestamp, active, display_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)",
        [id, session, role, extra.content ?? null, extra.tool_call_id ?? null, extra.tool_calls ?? null, extra.tool_name ?? null, extra.reasoning ?? null, 1791100000 + id],
      ] as [string, unknown[]];
    sqlite(
      join(h.hermes, "state.db"),
      `CREATE TABLE sessions (id TEXT, source TEXT, cwd TEXT, git_repo_root TEXT, parent_session_id TEXT, started_at REAL, ended_at REAL, last_activity_at REAL);
       CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, reasoning TEXT, timestamp REAL, active INTEGER, display_kind TEXT);
       CREATE TABLE session_turn_leases (conversation_id TEXT, holder TEXT);`,
      [
        ["INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["20261004_091200_ab", "cli", "/work/app", "/work/app", null, 1791100000, null, null]],
        ["INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["20261004_091300_cd", "subagent", null, null, "20261004_091200_ab", 1791100050, 1791100080, null]],
        row(1, "20261004_091200_ab", "user", { content: "Fix the failing test" }),
        row(2, "20261004_091200_ab", "assistant", {
          content: "",
          reasoning: "The test fails because…",
          tool_calls: JSON.stringify([
            { id: "call_a1", type: "function", function: { name: "terminal", arguments: JSON.stringify({ command: "npm test" }) } },
            { id: "call_a2", type: "function", function: { name: "patch", arguments: JSON.stringify({ path: "src/x.ts", old_string: "a", new_string: "b" }) } },
          ]),
        }),
        row(3, "20261004_091200_ab", "tool", { tool_call_id: "call_a1", tool_name: "terminal", content: JSON.stringify({ output: "1 failing", exit_code: 1, error: null }) }),
        row(4, "20261004_091200_ab", "tool", { tool_call_id: "call_a2", tool_name: "patch", content: JSON.stringify({ success: true, diff: "--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\n-a\n+b\n" }) }),
        row(5, "20261004_091200_ab", "assistant", { content: "Fixed: the test passes now." }),
        row(6, "20261004_091300_cd", "user", { content: "Check the other tests\nin src/" }),
      ],
    );
    const result = new Conversations(defaultVendors(h)).get(agent("hermes"), { paneId: "w1:p1" });
    if (!result.available) throw new Error(result.reason);
    expect(shape(result.entries)).toEqual(["user:Fix the failing test", "thinking:The test fails because…", "tool:terminal", "tool:patch(+1-1)", "result:false", "result:true", "assistant:Fixed: the test passes n"]);
    expect(result.subagents).toEqual([expect.objectContaining({ id: "20261004_091300_cd", name: "Check the other tests", status: "done" })]);
  });
});
