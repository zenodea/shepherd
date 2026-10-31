import { describe, expect, it } from "vitest";
import type { AgentInfo, StatusChange } from "@shepherd/protocol";
import { AgentTracker } from "../herdr/agent-tracker.ts";
import { until } from "../testing/fake-herdr.ts";
import { kindOf, RexClient, rexError, translateEvent, type RexEventSource, type RexRunner } from "./rex-client.ts";
import { RexTerminalStream } from "./rex-terminal.ts";

const S1 = "session:01";
const W1 = "window:01";
const W2 = "window:02";
const CLAUDE = "block:claude";
const CODEX = "block:codex";
const SHELL = "block:shell";
const HIDDEN = "block:hidden";

type Block = { process: Record<string, unknown>; records?: Record<string, unknown>[]; title?: string; content?: string; rows?: number };

/** A pretend `rex`: one session with Claude and a shell in one window, Codex in another. */
class FakeRex {
  calls: string[][] = [];
  blocks: Record<string, Block> = {
    [CLAUDE]: {
      process: { pid: 10, name: "2.1.314", argv0: "claude", invoked_path: "/Users/me/.local/bin/claude", cwd: "/work/app" },
      records: [{ state: "blocked", kind: "permission", msg: "  Running npm test  ", app: "claude-code", owner: { pid: 10, name: "2.1.314" } }],
      title: "Fix the login",
      content: "one\r\ntwo\r\nthree\r\nfour\r\n",
      rows: 2,
    },
    // Codex runs under node here, so only the status it reports says what it is.
    [CODEX]: { process: { pid: 20, name: "node", argv0: "node", cwd: "/work/api" }, records: [{ state: "working", app: "codex", owner: { pid: 20, name: "node" } }] },
    [SHELL]: { process: { pid: 30, name: "zsh", argv0: "-zsh", cwd: "/work" }, records: [{ state: "done", app: "claude-code", owner: { pid: 99, name: "gone" } }] },
    // Started from the phone, in no window.
    [HIDDEN]: { process: { pid: 50, name: "codex", argv0: "codex", cwd: "/work/web" }, records: [{ state: "working", msg: "Reading files", app: "codex", owner: { pid: 50, name: "codex" } }] },
  };
  created = 0;
  lines: ((line: string) => void)[] = [];

  run: RexRunner = async (args) => {
    this.calls.push(args);
    if (args[0] === "send-key") return "";
    const [, , method, raw] = args;
    const params = JSON.parse(raw!) as Record<string, unknown>;
    switch (method) {
      case "server.version":
        return JSON.stringify({ rex_version: "0.0.1" });
      case "session.list":
        return JSON.stringify({ sessions: [{ session_id: S1, label: "work" }] });
      case "session.view":
        return JSON.stringify({
          revision: 7,
          session_id: S1,
          label: "work",
          active_window_id: W1,
          windows: [
            {
              window_id: W1,
              label: "Window 0a1b2c3d",
              focused_block_id: CLAUDE,
              layers: [{ blocks: [{ block_id: CLAUDE, label: "shell", creator_name: "com.superlogical.terminal" }, { block_id: SHELL, label: "logs", creator_name: "com.superlogical.terminal" }] }],
            },
            { window_id: W2, label: "api", focused_block_id: CODEX, layers: [{ blocks: [{ block_id: CODEX, creator_name: "com.superlogical.terminal" }] }] },
          ],
        });
      case "session.list_blocks":
        return JSON.stringify({
          blocks: [
            { block_id: CLAUDE, creator_name: "com.superlogical.terminal", placement: "placed", window_id: W1 },
            { block_id: HIDDEN, creator_name: "com.superlogical.terminal", placement: "detached" },
          ],
        });
      case "session.new_block":
        return JSON.stringify({ block_id: `block:new${++this.created}`, revision: 7 });
      case "session.new_window":
        return JSON.stringify({ window_id: "window:new", block_ids: ["block:standin"], revision: 8 });
      case "block.method": {
        const block = this.blocks[params.block_id as string];
        if (!block) throw rexError("Error: block not found (status=404 code=not_found)");
        switch (params.method) {
          case "process":
            return JSON.stringify({ foreground: block.process });
          case "program_status":
            return JSON.stringify({ records: block.records ?? [] });
          case "title":
            return JSON.stringify({ title: block.title ?? "" });
          case "format":
            return JSON.stringify({ content: block.content ?? "" });
          case "size":
            return JSON.stringify({ columns: 80, rows: block.rows ?? 24 });
        }
        return "{}";
      }
    }
    return "{}";
  };

  events: RexEventSource = (onLine, onExit) => {
    this.lines.push(onLine);
    return { close: () => onExit("closed") };
  };

  push(event: Record<string, unknown>): void {
    for (const line of this.lines) line(JSON.stringify(event));
  }
}

const blockEvent = (block: string, name: string, payload: Record<string, unknown>) => ({
  type: "session_event",
  payload: { session_id: S1, event: { type: "block_event", payload: { block_id: block, creator_name: "com.superlogical.terminal", name, payload } } },
});
const statusEvent = (block: string, state: string, id = "", more: Record<string, unknown> = {}) => blockEvent(block, "program_status_changed", { id, record: { state, ...more } });

const client = (rex = new FakeRex()) => ({ rex, client: new RexClient({ run: rex.run, events: rex.events, server: "/tmp/rex.sock" }) });

describe("RexClient", () => {
  it("lists the agents in every session, as herdr would", async () => {
    const { client: c } = client();
    const { agents } = await c.request<{ agents: AgentInfo[] }>("agent.list");
    expect(agents.map((a) => [a.pane_id, a.agent, a.agent_status])).toEqual([
      [HIDDEN, "codex", "working"],
      [CLAUDE, "claude", "blocked"],
      [CODEX, "codex", "working"],
    ]);
    expect(agents[1]).toMatchObject({ workspace_id: S1, tab_id: W1, cwd: "/work/app", title: "Fix the login", name: null, focused: true, revision: 7, hidden: false });
  });

  it("says what each agent is doing now, and what a blocked one waits for", async () => {
    const { client: c } = client();
    const { agents } = await c.request<{ agents: AgentInfo[] }>("agent.list");
    expect(agents.map((a) => [a.pane_id, a.status_text, a.blocked_on])).toEqual([
      [HIDDEN, "Reading files", null],
      [CLAUDE, "Running npm test", "permission"],
      [CODEX, null, null],
    ]);
  });

  it("lists agents in no window as hidden, outside any tab", async () => {
    const { client: c } = client();
    const { agents } = await c.request<{ agents: AgentInfo[] }>("agent.list");
    expect(agents[0]).toMatchObject({ pane_id: HIDDEN, tab_id: "", hidden: true, focused: false });
  });

  it("starts a hidden agent in a shell of no window, which goes when the agent does", async () => {
    const { rex, client: c } = client();
    const created = await c.request<{ root_pane: { pane_id: string; tab_id: string } }>("tab.create", { workspace_id: S1, cwd: "/work", hidden: true });
    expect(created.root_pane).toEqual({ pane_id: "block:new1", workspace_id: S1, tab_id: "" });
    expect(JSON.parse(rex.calls.find((a) => a[2] === "session.new_block")![3]!)).toEqual({ session_id: S1, flavor: "com.superlogical.terminal.shell", options: { cwd: "/work" } });

    rex.blocks[HIDDEN]!.process = { pid: 51, name: "zsh", argv0: "-zsh", cwd: "/work" };
    await expect(c.request("agent.start", { kind: "claude", pane_id: HIDDEN })).rejects.toMatchObject({ code: "agent_not_ready" });
    const write = rex.calls.find((a) => a[2] === "block.method" && JSON.parse(a[3]!).method === "write")!;
    expect(JSON.parse(write[3]!).args).toEqual({ data: "claude; exit\r" });
  });

  it("puts a hidden agent on the desktop in a window of its own", async () => {
    const { rex, client: c } = client();
    await c.request("pane.place", { pane_id: HIDDEN, label: "codex" });
    const calls = rex.calls.filter((a) => a[0] === "api" && /^session\.(new_window|move_block)$|^block\.close$/.test(a[2]!)).map((a) => [a[2], JSON.parse(a[3]!)]);
    expect(calls).toEqual([
      ["session.new_window", { session_id: S1, focus: false, window_label: "codex", layout: { block: { flavor: "com.superlogical.terminal.shell", options: { cwd: "/work/web" } } } }],
      ["session.move_block", { session_id: S1, block_id: HIDDEN, anchor_block_id: "block:standin" }],
      ["block.close", { session_id: S1, block_id: "block:standin" }],
    ]);
  });

  it("doesn't take a shell for an agent from a status its last program left behind", () => {
    expect(kindOf({ pid: 30, argv0: "-zsh" }, [{ state: "done", app: "claude-code", owner: { pid: 99, name: "gone" } }])).toBeNull();
  });

  it("numbers windows Rex named itself, and keeps the names people gave", async () => {
    const { client: c } = client();
    const { snapshot } = await c.request<{ snapshot: { tabs: { label: string }[]; panes: { pane_id: string; label: string | null }[] } }>("session.snapshot");
    expect(snapshot.tabs.map((t) => t.label)).toEqual(["1", "api"]);
    expect(snapshot.panes.map((p) => [p.pane_id, p.label])).toEqual([
      [HIDDEN, null],
      [CLAUDE, null],
      [SHELL, "logs"],
      [CODEX, null],
    ]);
  });

  it("reads the visible screen as its last rows", async () => {
    const { client: c } = client();
    const { read } = await c.request<{ read: { text: string; truncated: boolean } }>("agent.read", { target: CLAUDE, source: "visible", format: "text" });
    expect(read).toMatchObject({ text: "three\nfour", truncated: true });
  });

  it("pastes a prompt, then presses Enter", async () => {
    const { rex, client: c } = client();
    await c.request("agent.prompt", { target: CLAUDE, text: "line one\nline two" });
    const event = rex.calls.find((a) => a[2] === "block.event")!;
    expect(JSON.parse(event[3]!)).toMatchObject({ session_id: S1, block_id: CLAUDE, event: { type: "paste", payload: { text: "line one\nline two" } } });
    expect(rex.calls.at(-1)).toEqual(["send-key", "-s", S1, "-b", CLAUDE, "enter"]);
  });

  it("sends herdr's key names, and refuses anything else", async () => {
    const { rex, client: c } = client();
    await c.request("agent.send_keys", { target: CLAUDE, keys: ["shift+tab", "esc", "ctrl+c"] });
    expect(rex.calls.at(-1)).toEqual(["send-key", "-s", S1, "-b", CLAUDE, "shift+tab", "esc", "ctrl+c"]);
    await expect(c.request("pane.send_keys", { pane_id: SHELL, keys: ["--server=elsewhere x"] })).rejects.toMatchObject({ code: "invalid_params" });
  });

  it("starts an agent by typing it into the shell, then waits for it like herdr's agent.wait", async () => {
    const { rex, client: c } = client();
    await expect(c.request("agent.start", { kind: "claude", pane_id: SHELL })).rejects.toMatchObject({ code: "agent_not_ready" });
    const write = rex.calls.find((a) => a[2] === "block.method" && JSON.parse(a[3]!).method === "write")!;
    expect(JSON.parse(write[3]!)).toMatchObject({ block_id: SHELL, args: { data: "claude\r" } });
    await expect(c.request("agent.start", { kind: "rm -rf", pane_id: SHELL })).rejects.toMatchObject({ code: "invalid_params" });

    rex.blocks[SHELL]!.process = { pid: 40, argv0: "claude", cwd: "/work" };
    rex.blocks[SHELL]!.records = [{ state: "idle", app: "claude-code", owner: { pid: 40, name: "claude" } }];
    await expect(c.request("agent.wait", { target: SHELL, until: ["idle"], timeout_ms: 2000 })).resolves.toMatchObject({ status: "idle" });
  });

  it("says which pane is gone, and which methods Rex can't answer", async () => {
    const { client: c } = client();
    await expect(c.request("pane.read", { pane_id: "block:nope" })).rejects.toMatchObject({ code: "pane_not_found" });
    await expect(c.request("plugin.list")).rejects.toMatchObject({ code: "unsupported" });
  });

  it("keeps the error code rex prints", () => {
    expect(rexError("Error: session x not found (status=404 code=session_not_found)").code).toBe("session_not_found");
    expect(rexError("Error: dial unix /tmp/rex.sock: connect: no such file or directory").code).toBe("disconnected");
  });
});

describe("Rex events", () => {
  it("become herdr's: status from the program's own record, panes opening and closing", () => {
    expect(translateEvent(statusEvent(CLAUDE, "blocked", "", { kind: "question", msg: "Which database?" }))).toEqual([
      { event: "pane.agent_status_changed", data: { pane_id: CLAUDE, workspace_id: S1, agent_status: "blocked", status_text: "Which database?", blocked_on: "question" } },
    ]);
    // A task the program reports under itself isn't the program's status.
    expect(translateEvent(statusEvent(CLAUDE, "working", "build/test"))).toEqual([]);
    expect(translateEvent({ type: "session_event", payload: { session_id: S1, event: { type: "block_closed", payload: { block_id: SHELL } } } })).toEqual([
      { event: "pane.closed", data: { pane_id: SHELL, workspace_id: S1 } },
    ]);
    expect(translateEvent({ type: "client_joined", payload: {} })).toEqual([]);
  });

  it("pass on what a program copies, cut short when it's long", () => {
    expect(translateEvent(blockEvent(CLAUDE, "clipboard_written", { text: "npm run dev", id: 1, bytes: 11 }))).toEqual([
      { event: "pane.clipboard_written", data: { pane_id: CLAUDE, workspace_id: S1, text: "npm run dev", truncated: false } },
    ]);
    const [long] = translateEvent(blockEvent(CLAUDE, "clipboard_written", { text: "x".repeat(20_000), id: 2, bytes: 20_000 }));
    expect(long!.data).toMatchObject({ truncated: true });
    expect((long!.data.text as string).length).toBe(16_000);
    // Too long for the event: Rex sends no text at all.
    expect(translateEvent(blockEvent(CLAUDE, "clipboard_written", { id: 3, bytes: 2_000_000 }))).toEqual([]);
  });

  it("reach the tracker, which reports the change", async () => {
    const { rex, client: c } = client();
    const tracker = new AgentTracker(c);
    const changes: StatusChange[] = [];
    tracker.on("status", (s) => changes.push(s));
    await tracker.start();
    await until(() => rex.lines.length === 2);
    await new Promise((r) => setTimeout(r, 350));

    rex.blocks[CLAUDE]!.records = [{ state: "working", app: "claude-code", owner: { pid: 10, name: "2.1.314" } }];
    rex.push(statusEvent(CLAUDE, "working"));
    await until(() => changes.length > 0);
    expect(changes[0]).toMatchObject({ paneId: CLAUDE, status: "working", previous: "blocked" });
    tracker.stop();
  });

  it("send the list again when only the status line changes, without a status change", async () => {
    const { rex, client: c } = client();
    const tracker = new AgentTracker(c, { copies: true });
    const changes: StatusChange[] = [];
    const lists: AgentInfo[][] = [];
    const copies: unknown[] = [];
    tracker.on("status", (s) => changes.push(s));
    tracker.on("agents", (a) => lists.push(a));
    tracker.on("copied", (c) => copies.push(c));
    await tracker.start();
    await until(() => rex.lines.length === 2);
    await new Promise((r) => setTimeout(r, 350));
    const before = lists.length;

    rex.push(statusEvent(CLAUDE, "blocked", "", { kind: "permission", msg: "Editing login.ts" }));
    await until(() => lists.length > before, 3000);
    expect(changes).toEqual([]);
    expect(tracker.get(CLAUDE)).toMatchObject({ status_text: "Editing login.ts", blocked_on: "permission" });

    rex.push(blockEvent(CLAUDE, "clipboard_written", { text: "https://example.com/pr/1", id: 1, bytes: 24 }));
    await until(() => copies.length === 1);
    expect(copies[0]).toEqual({ type: "agent.copied", paneId: CLAUDE, text: "https://example.com/pr/1", truncated: false });
    tracker.stop();
  });
});

describe("RexTerminalStream", () => {
  it("sends the screen when it changes, and types what the phone types", async () => {
    const { rex, client: c } = client();
    rex.blocks[CLAUDE]!.content = "a\r\nb\r\n\x1b[2;1H";
    const stream = new RexTerminalStream(c, { paneId: CLAUDE, mode: "control", cols: 80, rows: 2 });
    const frames: string[] = [];
    stream.on("frame", (f) => frames.push(Buffer.from(f.bytes, "base64").toString()));
    await until(() => frames.length === 1);
    expect(frames[0]).toBe("\x1b[H\x1b[2Ja\r\nb\x1b[2;1H");

    expect(stream.send({ type: "terminal.input", text: "y" })).toBe(true);
    await until(() => rex.calls.some((a) => a[2] === "block.method" && JSON.parse(a[3]!).method === "write"));
    // Unchanged screen: nothing new sent.
    await new Promise((r) => setTimeout(r, 300));
    expect(frames).toHaveLength(1);
    stream.close();
  });
});
