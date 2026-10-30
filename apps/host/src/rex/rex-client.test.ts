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

type Block = { process: Record<string, unknown>; records?: Record<string, unknown>[]; title?: string; content?: string; rows?: number };

/** A pretend `rex`: one session with Claude and a shell in one window, Codex in another. */
class FakeRex {
  calls: string[][] = [];
  blocks: Record<string, Block> = {
    [CLAUDE]: {
      process: { pid: 10, name: "2.1.314", argv0: "claude", invoked_path: "/Users/me/.local/bin/claude", cwd: "/work/app" },
      records: [{ state: "blocked", app: "claude-code", owner: { pid: 10, name: "2.1.314" } }],
      title: "Fix the login",
      content: "one\r\ntwo\r\nthree\r\nfour\r\n",
      rows: 2,
    },
    // Codex runs under node here, so only the status it reports says what it is.
    [CODEX]: { process: { pid: 20, name: "node", argv0: "node", cwd: "/work/api" }, records: [{ state: "working", app: "codex", owner: { pid: 20, name: "node" } }] },
    [SHELL]: { process: { pid: 30, name: "zsh", argv0: "-zsh", cwd: "/work" }, records: [{ state: "done", app: "claude-code", owner: { pid: 99, name: "gone" } }] },
  };
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

const statusEvent = (block: string, state: string, id = "") => ({
  type: "session_event",
  payload: { session_id: S1, event: { type: "block_event", payload: { block_id: block, creator_name: "com.superlogical.terminal", name: "program_status_changed", payload: { id, record: { state } } } } },
});

const client = (rex = new FakeRex()) => ({ rex, client: new RexClient({ run: rex.run, events: rex.events, server: "/tmp/rex.sock" }) });

describe("RexClient", () => {
  it("lists the agents in every session, as herdr would", async () => {
    const { client: c } = client();
    const { agents } = await c.request<{ agents: AgentInfo[] }>("agent.list");
    expect(agents.map((a) => [a.pane_id, a.agent, a.agent_status])).toEqual([
      [CLAUDE, "claude", "blocked"],
      [CODEX, "codex", "working"],
    ]);
    expect(agents[0]).toMatchObject({ workspace_id: S1, tab_id: W1, cwd: "/work/app", title: "Fix the login", name: null, focused: true, revision: 7 });
  });

  it("doesn't take a shell for an agent from a status its last program left behind", () => {
    expect(kindOf({ pid: 30, argv0: "-zsh" }, [{ state: "done", app: "claude-code", owner: { pid: 99, name: "gone" } }])).toBeNull();
  });

  it("numbers windows Rex named itself, and keeps the names people gave", async () => {
    const { client: c } = client();
    const { snapshot } = await c.request<{ snapshot: { tabs: { label: string }[]; panes: { pane_id: string; label: string | null }[] } }>("session.snapshot");
    expect(snapshot.tabs.map((t) => t.label)).toEqual(["1", "api"]);
    expect(snapshot.panes.map((p) => [p.pane_id, p.label])).toEqual([
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
    expect(translateEvent(statusEvent(CLAUDE, "blocked"))).toEqual([{ event: "pane.agent_status_changed", data: { pane_id: CLAUDE, workspace_id: S1, agent_status: "blocked" } }]);
    // A task the program reports under itself isn't the program's status.
    expect(translateEvent(statusEvent(CLAUDE, "working", "build/test"))).toEqual([]);
    expect(translateEvent({ type: "session_event", payload: { session_id: S1, event: { type: "block_closed", payload: { block_id: SHELL } } } })).toEqual([
      { event: "pane.closed", data: { pane_id: SHELL, workspace_id: S1 } },
    ]);
    expect(translateEvent({ type: "client_joined", payload: {} })).toEqual([]);
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
