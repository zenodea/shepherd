// End-to-end: real Worker + Durable Object in workerd, real host tunnel, fake herdr.
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";
import { WebSocket } from "ws";
import type { ServerMessage } from "@shepherd/protocol";
import { generateKeyPair, relayCredential, relayPaths } from "@shepherd/protocol";
import { AgentTracker } from "../../host/src/herdr/agent-tracker.ts";
import { HerdrClient } from "../../host/src/herdr/herdr-client.ts";
import { RelayTunnel, type TunnelState } from "../../host/src/connection/relay-tunnel.ts";
import { testDevices } from "../../host/src/testing/devices.ts";
import { secureClient } from "../../host/src/testing/secure-client.ts";
import { FakeHerdr, fakeAgent, until } from "../../host/src/testing/fake-herdr.ts";

const HOST_TOKEN = "relay-host-secret";
const HOST_ID = "test-host";

type Worker = Awaited<ReturnType<typeof unstable_startWorker>>;

/**
 * Connect through the relay as the app does: show the relay only
 * relayCredential(token), then handshake and authenticate inside the
 * encrypted channel.
 */
function connectApp(base: string, token: string | null, hostId = HOST_ID) {
  const url = base.replace(/^http/, "ws") + relayPaths.connect(hostId);
  const ws = new WebSocket(url, { headers: token ? { authorization: `Bearer ${relayCredential(token)}` } : {} });
  const client = secureClient(ws, token, "relay phone");
  const opened = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", reject);
  });
  return { ws, messages: client.messages, opened, send: client.send };
}

describe("relay", () => {
  let worker: Worker;
  let base: string;
  let herdr: FakeHerdr;
  let client: HerdrClient;
  let tracker: AgentTracker;
  let tunnel: RelayTunnel;
  let devices: ReturnType<typeof testDevices>;
  let APP_TOKEN: string;
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
    devices = testDevices();
    APP_TOKEN = devices.token;
  }, 60_000);

  afterAll(async () => {
    tunnel?.stop();
    tracker?.stop();
    client?.close();
    await herdr?.close();
    devices?.cleanup();
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
      deps: {
        herdr: client,
        tracker,
        devices: devices.registry,
        hostKey: generateKeyPair(),
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

  it("takes the app's token only from the header", async () => {
    const url = `${base.replace(/^http/, "ws")}${relayPaths.connect(HOST_ID)}?token=${encodeURIComponent(relayCredential(APP_TOKEN))}`;
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.once("open", () => reject(new Error("admitted with a query token")));
      ws.once("error", reject);
    });
    expect(status).toBe(401);
  });

  it("answers a badly encoded host id with 400", async () => {
    expect((await fetch(`${base}/hosts/%E0/connect`)).status).toBe(400);
  });

  it("splices an app through to the host session", async () => {
    herdr.handlers["agent.prompt"] = (params) => ({ type: "ok", params });
    const app = connectApp(base, APP_TOKEN);
    await app.opened;
    await until(() => app.messages.some((m) => m.type === "hello"), 5000);
    expect(app.messages[0]).toMatchObject({ type: "hello", host: { name: "relay-test" }, agents: [{ pane_id: "w1:p1" }] });

    app.send({ type: "call", id: "p", method: "agent.prompt", params: { target: "w1:p1", text: "via relay" } });
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

  it("pairs through the relay and admits the new device token", async () => {
    const { code } = devices.registry.createPairing();
    // The host re-registers hashes when pairing codes change.
    await new Promise((r) => setTimeout(r, 300));
    const pairing = connectApp(base, code);
    await pairing.opened;
    await until(() => pairing.messages.some((m) => m.type === "hello"), 5000);
    const hello = pairing.messages.find((m) => m.type === "hello");
    const issued = hello?.type === "hello" ? hello.credentials?.token : undefined;
    expect(issued).toMatch(/^d_/);
    pairing.ws.close();

    await new Promise((r) => setTimeout(r, 300));
    const again = connectApp(base, issued!);
    await again.opened;
    await until(() => again.messages.some((m) => m.type === "hello"), 5000);
    again.ws.close();
  }, 20_000);

  it("stops admitting a revoked device at the relay", async () => {
    const extra = devices.registry.authenticate(devices.registry.createPairing().code, "to revoke");
    if (!extra.ok) throw new Error();
    await new Promise((r) => setTimeout(r, 300));
    devices.registry.revoke(extra.device.id);
    await new Promise((r) => setTimeout(r, 300));
    await expect(connectApp(base, extra.issuedToken!).opened).rejects.toThrow("401");
  }, 20_000);

  it("keeps separate app connections isolated", async () => {
    const a = connectApp(base, APP_TOKEN);
    const b = connectApp(base, APP_TOKEN);
    await Promise.all([a.opened, b.opened]);
    await until(() => a.messages.some((m) => m.type === "hello") && b.messages.some((m) => m.type === "hello"), 5000);
    a.send({ type: "ping", t: 1 });
    b.send({ type: "ping", t: 2 });
    await until(() => a.messages.some((m) => m.type === "pong") && b.messages.some((m) => m.type === "pong"), 5000);
    expect(a.messages.filter((m) => m.type === "pong")).toEqual([{ type: "pong", t: 1 }]);
    expect(b.messages.filter((m) => m.type === "pong")).toEqual([{ type: "pong", t: 2 }]);
    a.ws.close();
    b.ws.close();
  }, 20_000);

  it("tells only admitted apps that the host is offline", async () => {
    tunnel.stop();
    await new Promise((r) => setTimeout(r, 300));
    await expect(connectApp(base, APP_TOKEN).opened).rejects.toThrow("503");
    await expect(connectApp(base, "wrong").opened).rejects.toThrow("401");
  }, 20_000);
});
