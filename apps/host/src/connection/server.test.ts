import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { CLOSE_CODES, generateKeyPair, type ServerMessage } from "@sheperd/protocol";
import { AgentTracker } from "../herdr/agent-tracker.ts";
import { HerdrClient, lineReader } from "../herdr/herdr-client.ts";
import { startLocalServer, type LocalServer } from "./server.ts";
import { TerminalStream, terminalSessionArgs } from "../herdr/terminal-stream.ts";
import { testDevices } from "../testing/devices.ts";
import { secureClient, type SecureTestClient } from "../testing/secure-client.ts";
import { FakeHerdr, fakeAgent, until } from "../testing/fake-herdr.ts";


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

type Client = SecureTestClient & { ws: WebSocket };

/** Connect, complete the encryption handshake, and send `auth` with `token` (or nothing when null). */
function connect(port: number, token: string | null): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/connect`);
  const client = secureClient(ws, token);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve({ ...client, ws }));
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
  let devices: ReturnType<typeof testDevices>;
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
    devices = testDevices();
    server = await startLocalServer({
      port: 0,
      bind: "127.0.0.1",
      deps: {
        herdr: client,
        tracker,
        devices: devices.registry,
        hostKey: generateKeyPair(),
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
    devices.cleanup();
  });

  async function open(token: string = devices.token) {
    const c = await connect(server.port, token);
    clients.push(c);
    await until(() => find(c, "hello") !== undefined);
    return c;
  }

  it("turns away unknown tokens without revealing anything", async () => {
    const c = await connect(server.port, "d_wrong");
    clients.push(c);
    await until(() => c.closeCode() !== null);
    expect(c.closeCode()).toBe(CLOSE_CODES.unauthorized);
    expect(c.messages).toEqual([{ type: "auth.error", code: "invalid", message: expect.any(String) }]);
  });

  it("requires auth before anything else", async () => {
    const c = await connect(server.port, null);
    clients.push(c);
    await until(() => c.hostKey() !== null);
    await new Promise((r) => setTimeout(r, 20));
    c.send({ type: "call", id: "1", method: "agent.list", params: {} });
    await until(() => c.closeCode() !== null);
    expect(c.closeCode()).toBe(CLOSE_CODES.unauthorized);
    expect(herdr.requests.filter((r) => r.method === "agent.list")).toHaveLength(1); // only the tracker's
  });

  it("pairs a phone with a one-time code and issues it a token", async () => {
    const { code } = devices.registry.createPairing();
    const c = await open(code);
    const hello = find(c, "hello")!;
    expect(hello.device.name).toBe("Test phone");
    expect(hello.credentials?.token).toMatch(/^d_/);

    const again = await connect(server.port, code);
    clients.push(again);
    await until(() => again.closeCode() !== null);
    expect(again.closeCode()).toBe(CLOSE_CODES.pairingExpired);

    const reconnect = await open(hello.credentials!.token);
    expect(find(reconnect, "hello")).toMatchObject({ device: { id: hello.device.id } });
    expect(find(reconnect, "hello")?.credentials).toBeUndefined();
  });

  it("disconnects a device as soon as it is revoked", async () => {
    const c = await open();
    devices.registry.revoke(devices.deviceId);
    await until(() => c.closeCode() !== null);
    expect(c.closeCode()).toBe(CLOSE_CODES.revoked);
    expect(find(c, "auth.error")?.code).toBe("revoked");
  });

  it("encrypts everything after the handshake", async () => {
    const raw: { text: string; binary: boolean }[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/connect`);
    ws.on("message", (data, isBinary) => raw.push({ text: data.toString("latin1"), binary: isBinary }));
    const c = secureClient(ws, devices.token);
    clients.push({ ...c, ws });
    await until(() => c.messages.some((m) => m.type === "hello"));
    expect(raw[0]!.binary).toBe(false); // ready: public keys only
    expect(raw.slice(1).every((f) => f.binary)).toBe(true);
    expect(raw.map((f) => f.text).join("")).not.toContain("test-host");
    expect(raw.map((f) => f.text).join("")).not.toContain("w1:p1");
  });

  it("drops connections that skip the handshake or send junk", async () => {
    const plain = new WebSocket(`ws://127.0.0.1:${server.port}/connect`);
    let code: number | null = null;
    plain.on("close", (c) => (code = c));
    plain.on("message", () => plain.send(JSON.stringify({ type: "auth", token: devices.token, device: { name: "x" } })));
    await until(() => code !== null);
    expect(code).toBe(CLOSE_CODES.insecure);
  });

  it("greets with host info and the current agents", async () => {
    const c = await open();
    expect(find(c, "hello")).toMatchObject({
      protocol: 3,
      device: { id: devices.deviceId, name: "Test phone" },
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

  it("renders a stream as styled lines on request", async () => {
    const c = await open();
    c.send({ type: "terminal.open", streamId: "s1", paneId: "w1:p1", mode: "control", cols: 20, rows: 3, render: "lines" });
    await until(() => children.length === 1);
    const bytes = Buffer.from("\u001b[2J\u001b[H\u001b[31mred\u001b[0m text").toString("base64");
    children[0]!.stdout.write(JSON.stringify({ type: "terminal.frame", seq: 1, encoding: "ansi", width: 20, height: 3, full: true, bytes }) + "\n");
    await until(() => find(c, "terminal.lines") !== undefined);
    expect(find(c, "terminal.lines")).toMatchObject({
      streamId: "s1",
      width: 20,
      height: 3,
      full: true,
      lines: { 0: [["red", "#F87171", null, 0], [" text", null, null, 0]], 1: [], 2: [] },
    });
    expect(find(c, "terminal.frame")).toBeUndefined();
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

  it("opens terminals at the pane's own size when none is requested", async () => {
    herdr.handlers["pane.layout"] = ({ pane_id }) => ({
      type: "pane_layout",
      layout: { panes: [{ pane_id, rect: { x: 0, y: 0, width: 132, height: 41 } }] },
    });
    const c = await open();
    c.send({ type: "terminal.open", streamId: "s1", paneId: "w1:p1", mode: "observe" });
    await until(() => children.length === 1);
    expect(children[0]!.args).toEqual(terminalSessionArgs({ paneId: "w1:p1", mode: "observe", cols: 132, rows: 41 }));
  });

  it("restores the pane size after a phone-sized controller closes", async () => {
    herdr.handlers["pane.layout"] = ({ pane_id }) => ({
      type: "pane_layout",
      layout: { panes: [{ pane_id, rect: { x: 0, y: 0, width: 132, height: 41 } }] },
    });
    const c = await open();
    c.send({ type: "terminal.open", streamId: "s1", paneId: "w1:p1", mode: "control", cols: 48, rows: 30 });
    await until(() => children.length === 1);
    expect(children[0]!.args).toContain("48");

    c.send({ type: "terminal.close", streamId: "s1" });
    await until(() => children.length === 2);
    const restorer = children[1]!;
    expect(restorer.args).toEqual(terminalSessionArgs({ paneId: "w1:p1", mode: "control", cols: 132, rows: 41 }));
    restorer.frame(1, "");
    await until(() => restorer.stdinLines.some((l) => JSON.parse(l).type === "terminal.release"));
  });

  it("does not restore when the controller used the pane's own size", async () => {
    herdr.handlers["pane.layout"] = ({ pane_id }) => ({
      type: "pane_layout",
      layout: { panes: [{ pane_id, rect: { x: 0, y: 0, width: 132, height: 41 } }] },
    });
    const c = await open();
    c.send({ type: "terminal.open", streamId: "s1", paneId: "w1:p1", mode: "control" });
    await until(() => children.length === 1);
    c.send({ type: "terminal.close", streamId: "s1" });
    await until(() => find(c, "terminal.closed") !== undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(children).toHaveLength(1);
  });

  it("closes a client's terminals when it disconnects", async () => {
    const c = await open();
    c.send({ type: "terminal.open", streamId: "s1", paneId: "w1:p1", mode: "observe", cols: 60, rows: 20 });
    await until(() => children.length === 1);
    c.ws.close();
    await until(() => children[0]!.killed);
  });
});
