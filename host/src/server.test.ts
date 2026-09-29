import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ServerMessage } from "@sheperd/protocol";
import { AgentTracker } from "./agent-tracker.ts";
import { HerdrClient, lineReader } from "./herdr-client.ts";
import { startLocalServer, type LocalServer } from "./server.ts";
import { TerminalStream, terminalSessionArgs } from "./terminal-stream.ts";
import { FakeHerdr, fakeAgent, until } from "./testing/fake-herdr.ts";

const TOKEN = "test-token";

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  stdinLines: string[] = [];
  readonly args: string[];
  constructor(args: string[]) {
    super();
    this.args = args;
    this.stdin.on("data", lineReader((l) => this.stdinLines.push(l)));
  }
  kill() {
    this.killed = true;
    this.emit("exit", null, "SIGTERM");
    return true;
  }
  frame(seq: number, text: string, full = seq === 1) {
    const bytes = Buffer.from(text).toString("base64");
    this.stdout.write(JSON.stringify({ type: "terminal.frame", seq, encoding: "ansi", width: 80, height: 24, full, bytes }) + "\n");
  }
}

type Client = { ws: WebSocket; messages: ServerMessage[]; send: (msg: unknown) => void };

function connect(port: number, token: string | null = TOKEN): Promise<Client> {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  const ws = new WebSocket(`ws://127.0.0.1:${port}/connect`, { headers });
  const messages: ServerMessage[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve({ ws, messages, send: (msg) => ws.send(JSON.stringify(msg)) }));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", reject);
  });
}

function find<T extends ServerMessage["type"]>(c: Client, type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true) {
  return c.messages.find((m): m is Extract<ServerMessage, { type: T }> => m.type === type && pred(m as never));
}

describe("local server", () => {
  let herdr: FakeHerdr;
  let client: HerdrClient;
  let tracker: AgentTracker;
  let server: LocalServer;
  let children: FakeChild[];
  const clients: Client[] = [];

  beforeEach(async () => {
    herdr = new FakeHerdr();
    await herdr.listen();
    herdr.agents = [fakeAgent("w1:p1", "working")];
    client = new HerdrClient(herdr.socketPath, 500);
    tracker = new AgentTracker(client);
    tracker.on("error", () => {});
    await tracker.start();
    children = [];
    server = await startLocalServer({
      port: 0,
      bind: "127.0.0.1",
      token: TOKEN,
      deps: {
        herdr: client,
        tracker,
        host: { name: "test-host", herdrVersion: "fake" },
        openTerminal: (paneId, mode, cols, rows) =>
          new TerminalStream({ herdrBin: "herdr", socketPath: herdr.socketPath, paneId, mode, cols, rows }, (_bin, args) => {
            const child = new FakeChild(args);
            children.push(child);
            return child as unknown as ChildProcessWithoutNullStreams;
          }),
      },
    });
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.terminate();
    await server.close();
    tracker.stop();
    client.close();
    await herdr.close();
  });

  async function open(token: string | null = TOKEN) {
    const c = await connect(server.port, token);
    clients.push(c);
    await until(() => find(c, "hello") !== undefined);
    return c;
  }

  it("rejects connections without the right token", async () => {
    await expect(connect(server.port, null)).rejects.toThrow("401");
    await expect(connect(server.port, "wrong")).rejects.toThrow("401");
  });

  it("greets with host info and the current agents", async () => {
    const c = await open();
    expect(find(c, "hello")).toMatchObject({
      protocol: 1,
      host: { name: "test-host", herdrVersion: "fake" },
      agents: [{ pane_id: "w1:p1", agent_status: "working" }],
    });
  });

  it("forwards allowlisted calls and returns herdr errors", async () => {
    herdr.handlers["agent.prompt"] = (params) => ({ type: "ok", echoed: params });
    const c = await open();
    c.send({ type: "call", id: "a", method: "agent.prompt", params: { target: "w1:p1", text: "hello" } });
    c.send({ type: "call", id: "b", method: "agent.read", params: { target: "w1:p1", source: "visible" } });
    await until(() => find(c, "result", (m) => m.id === "a") !== undefined && find(c, "error", (m) => m.id === "b") !== undefined);
    expect(find(c, "result", (m) => m.id === "a")?.result).toEqual({ type: "ok", echoed: { target: "w1:p1", text: "hello" } });
    expect(herdr.requests.some((r) => r.method === "agent.prompt")).toBe(true);
  });

  it("refuses methods outside the allowlist without calling herdr", async () => {
    const c = await open();
    c.send({ type: "call", id: "x", method: "pane.run", params: { pane_id: "w1:p1", command: "rm -rf ~" } });
    await until(() => find(c, "error", (m) => m.id === "x") !== undefined);
    expect(find(c, "error", (m) => m.id === "x")?.error.code).toBe("invalid_message");
    expect(herdr.requests.some((r) => r.method === "pane.run")).toBe(false);
  });

  it("pushes agent status changes", async () => {
    const c = await open();
    await until(() => herdr.subscriptionsFor("pane.agent_status_changed").length === 1);
    herdr.setStatus("w1:p1", "blocked");
    await until(() => find(c, "agent.status") !== undefined);
    expect(find(c, "agent.status")).toMatchObject({ paneId: "w1:p1", status: "blocked", previous: "working" });
  });

  it("streams terminal frames and relays control input", async () => {
    const c = await open();
    c.send({ type: "terminal.open", streamId: "s1", paneId: "w1:p1", mode: "control", cols: 60, rows: 20 });
    await until(() => children.length === 1);
    const child = children[0]!;
    expect(child.args).toEqual(terminalSessionArgs({ paneId: "w1:p1", mode: "control", cols: 60, rows: 20 }));
    expect(child.args).toContain("--takeover");

    child.frame(1, "hello");
    await until(() => find(c, "terminal.frame") !== undefined);
    const frame = find(c, "terminal.frame")!;
    expect(frame).toMatchObject({ streamId: "s1", seq: 1, full: true });
    expect(Buffer.from(frame.bytes, "base64").toString()).toBe("hello");

    c.send({ type: "terminal.input", streamId: "s1", text: "y" });
    c.send({ type: "terminal.resize", streamId: "s1", cols: 40, rows: 30 });
    await until(() => child.stdinLines.length === 2);
    expect(child.stdinLines.map((l) => JSON.parse(l))).toEqual([
      { type: "terminal.input", text: "y" },
      { type: "terminal.resize", cols: 40, rows: 30 },
    ]);

    c.send({ type: "terminal.close", streamId: "s1" });
    await until(() => find(c, "terminal.closed") !== undefined);
    expect(JSON.parse(child.stdinLines.at(-1)!)).toEqual({ type: "terminal.release" });
  });

  it("does not accept input on observe streams", async () => {
    const c = await open();
    c.send({ type: "terminal.open", streamId: "s1", paneId: "w1:p1", mode: "observe", cols: 60, rows: 20 });
    await until(() => children.length === 1);
    expect(children[0]!.args).not.toContain("--takeover");
    c.send({ type: "terminal.input", streamId: "s1", text: "y" });
    await until(() => find(c, "error") !== undefined);
    expect(children[0]!.stdinLines).toEqual([]);
  });

  it("closes a client's terminals when it disconnects", async () => {
    const c = await open();
    c.send({ type: "terminal.open", streamId: "s1", paneId: "w1:p1", mode: "observe", cols: 60, rows: 20 });
    await until(() => children.length === 1);
    c.ws.close();
    await until(() => children[0]!.killed);
  });
});
