// End-to-end: real Worker + Durable Object in workerd, real host tunnel, fake herdr.
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";
import { WebSocket } from "ws";
import type { ServerMessage } from "@sheperd/protocol";
import { relayPaths } from "@sheperd/protocol";
import { AgentTracker } from "../../host/src/agent-tracker.ts";
import { HerdrClient } from "../../host/src/herdr-client.ts";
import { RelayTunnel, type TunnelState } from "../../host/src/relay-tunnel.ts";
import { FakeHerdr, fakeAgent, until } from "../../host/src/testing/fake-herdr.ts";

const HOST_TOKEN = "relay-host-secret";
const APP_TOKEN = "app-secret";
const HOST_ID = "test-host";

type Worker = Awaited<ReturnType<typeof unstable_startWorker>>;

function connectApp(base: string, token: string | null, hostId = HOST_ID) {
  const url = base.replace(/^http/, "ws") + relayPaths.connect(hostId);
  const ws = new WebSocket(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const messages: ServerMessage[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  const opened = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", reject);
  });
  return { ws, messages, opened };
}

describe("relay", () => {
  let worker: Worker;
  let base: string;
  let herdr: FakeHerdr;
  let client: HerdrClient;
  let tracker: AgentTracker;
  let tunnel: RelayTunnel;
  const states: TunnelState[] = [];

  beforeAll(async () => {
    worker = await unstable_startWorker({
      config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
      bindings: { HOST_TOKEN: { type: "secret_text", value: HOST_TOKEN } },
      dev: { server: { hostname: "127.0.0.1", port: 0 }, inspector: false, persist: false, logLevel: "none" },
    } as Parameters<typeof unstable_startWorker>[0]);
    await worker.ready;
    base = (await worker.url).origin;

    herdr = new FakeHerdr();
    await herdr.listen();
    herdr.agents = [fakeAgent("w1:p1", "working")];
    client = new HerdrClient(herdr.socketPath, 1000);
    tracker = new AgentTracker(client);
    tracker.on("error", () => {});
    await tracker.start();
  }, 60_000);

  afterAll(async () => {
    tunnel?.stop();
    tracker?.stop();
    client?.close();
    await herdr?.close();
    await worker?.dispose();
  });

  it("reports the host offline before it connects", async () => {
    await expect(connectApp(base, APP_TOKEN).opened).rejects.toThrow("503");
  });

  it("rejects a host with the wrong relay token", async () => {
    const bad = new WebSocket(base.replace(/^http/, "ws") + relayPaths.control(HOST_ID), {
      headers: { authorization: "Bearer nope" },
    });
    const status = await new Promise<number>((resolve) => bad.once("unexpected-response", (_req, res) => resolve(res.statusCode!)));
    expect(status).toBe(401);
  });

  it("brings the host online", async () => {
    tunnel = new RelayTunnel({
      relayUrl: base,
      hostId: HOST_ID,
      hostToken: HOST_TOKEN,
      clientToken: APP_TOKEN,
      deps: {
        herdr: client,
        tracker,
        host: { name: "relay-test", herdrVersion: "fake" },
        openTerminal: () => {
          throw new Error("not used");
        },
      },
    });
    tunnel.on("state", (s) => states.push(s));
    tunnel.start();
    await until(() => states.includes("online"), 10_000);
  });

  it("rejects apps with the wrong token", async () => {
    await expect(connectApp(base, "wrong").opened).rejects.toThrow("401");
    await expect(connectApp(base, null).opened).rejects.toThrow("401");
  });

  it("splices an app through to the host session", async () => {
    herdr.handlers["agent.prompt"] = (params) => ({ type: "ok", params });
    const app = connectApp(base, APP_TOKEN);
    await app.opened;
    await until(() => app.messages.some((m) => m.type === "hello"), 5000);
    expect(app.messages[0]).toMatchObject({ type: "hello", host: { name: "relay-test" }, agents: [{ pane_id: "w1:p1" }] });

    app.ws.send(JSON.stringify({ type: "call", id: "p", method: "agent.prompt", params: { target: "w1:p1", text: "via relay" } }));
    await until(() => app.messages.some((m) => m.type === "result"), 5000);
    expect(app.messages.find((m) => m.type === "result")).toMatchObject({
      id: "p",
      result: { type: "ok", params: { target: "w1:p1", text: "via relay" } },
    });

    await until(() => herdr.subscriptionsFor("pane.agent_status_changed").length > 0);
    herdr.setStatus("w1:p1", "blocked");
    await until(() => app.messages.some((m) => m.type === "agent.status"), 5000);
    app.ws.close();
  }, 20_000);

  it("keeps separate app connections isolated", async () => {
    const a = connectApp(base, APP_TOKEN);
    const b = connectApp(base, APP_TOKEN);
    await Promise.all([a.opened, b.opened]);
    await until(() => a.messages.some((m) => m.type === "hello") && b.messages.some((m) => m.type === "hello"), 5000);
    a.ws.send(JSON.stringify({ type: "ping", t: 1 }));
    b.ws.send(JSON.stringify({ type: "ping", t: 2 }));
    await until(() => a.messages.some((m) => m.type === "pong") && b.messages.some((m) => m.type === "pong"), 5000);
    expect(a.messages.filter((m) => m.type === "pong")).toEqual([{ type: "pong", t: 1 }]);
    expect(b.messages.filter((m) => m.type === "pong")).toEqual([{ type: "pong", t: 2 }]);
    a.ws.close();
    b.ws.close();
  }, 20_000);
});
