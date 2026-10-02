// Runs the app's HostClient in Node against a real host server. The `ws`
// package's WebSocket takes (url, protocols, { headers }) like React Native's.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { AgentTracker } from "../../../host/src/herdr/agent-tracker";
import { HerdrClient } from "../../../host/src/herdr/herdr-client";
import { startLocalServer, type LocalServer } from "../../../host/src/connection/server";
import type { SessionDeps } from "../../../host/src/connection/session";
import { testDevices } from "../../../host/src/testing/devices";
import { FakeHerdr, fakeAgent, until } from "../../../host/src/testing/fake-herdr";
import { generateKeyPair, toHex } from "@shepherd/protocol";
import { HostClient, type ConnectionSettings } from "./host-client";

(globalThis as { WebSocket: unknown }).WebSocket = WebSocket;

// Nothing listens here, so connections are refused straight away.
const DEAD = "ws://127.0.0.1:9/connect";

describe("HostClient", () => {
  let herdr: FakeHerdr;
  let herdrClient: HerdrClient;
  let tracker: AgentTracker;
  let devices: ReturnType<typeof testDevices>;
  let deps: SessionDeps;
  let server: LocalServer;
  let good: string;
  let client: HostClient | null = null;

  const startServer = async (port = 0) => {
    server = await startLocalServer({ port, bind: "127.0.0.1", deps });
    return `ws://127.0.0.1:${server.port}/connect`;
  };

  beforeAll(async () => {
    herdr = new FakeHerdr();
    await herdr.listen();
    herdr.agents = [fakeAgent("w1:p1", "blocked")];
    herdrClient = new HerdrClient(herdr.socketPath, 1000);
    tracker = new AgentTracker(herdrClient);
    tracker.on("error", () => {});
    await tracker.start();
    devices = testDevices();
    deps = {
      herdr: herdrClient,
      tracker,
      devices: devices.registry,
      hostKey: generateKeyPair(),
      host: { name: "test-host", herdrVersion: "fake" },
      openTerminal: () => {
        throw new Error("unused");
      },
    };
    good = await startServer();
  });

  afterEach(() => {
    client?.stop();
    client = null;
    deps.host.addresses = undefined;
  });

  afterAll(async () => {
    await server.close();
    tracker.stop();
    herdrClient.close();
    await herdr.close();
    devices.cleanup();
  });

  it("uses whichever address answers when others are dead", async () => {
    client = new HostClient({ urls: [DEAD, good], token: devices.token }, { deviceName: "Pixel" });
    client.start();
    await until(() => client!.getState().status === "online", 5000);
    expect(client.getState()).toMatchObject({
      activeUrl: good,
      host: { name: "test-host" },
      device: { id: devices.deviceId },
      agents: [{ pane_id: "w1:p1", agent_status: "blocked" }],
    });
  });

  it("forwards calls once online", async () => {
    herdr.handlers["agent.prompt"] = (params) => ({ type: "ok", params });
    client = new HostClient({ urls: [good], token: devices.token });
    client.start();
    await until(() => client!.getState().status === "online", 5000);
    await expect(client.call("agent.prompt", { target: "w1:p1", text: "hi" })).resolves.toEqual({
      type: "ok",
      params: { target: "w1:p1", text: "hi" },
    });
  });

  it("reports offline when no address answers", async () => {
    client = new HostClient({ urls: [DEAD], token: devices.token });
    client.start();
    await until(() => client!.getState().status === "offline", 5000);
    await expect(client.call("agent.list")).rejects.toMatchObject({ code: "offline" });
  });

  it("stops retrying when the phone isn't paired", async () => {
    client = new HostClient({ urls: [good], token: "d_unknown" });
    client.start();
    await until(() => client!.getState().status === "unauthorized", 5000);
    expect(client.getState().error).toMatch(/isn't paired/);
  });

  it("redeems a pairing code, saves the issued token and reconnects with it", async () => {
    const { code } = devices.registry.createPairing();
    const saved: ConnectionSettings[] = [];
    // Two addresses racing with one single-use code: exactly one redeems it.
    client = new HostClient({ urls: [good, good.replace("127.0.0.1", "localhost")], token: code }, {
      deviceName: "Pixel 9",
      onSettingsChange: (s) => saved.push(s),
    });
    client.start();
    await until(() => client!.getState().status === "online", 5000);
    expect(client.getState().device?.name).toBe("Pixel 9");
    expect(saved.at(-1)?.token).toMatch(/^d_/);
    expect(devices.registry.list().filter((d) => d.name === "Pixel 9")).toHaveLength(1);

    client.stop();
    client = new HostClient(saved.at(-1)!);
    client.start();
    await until(() => client!.getState().status === "online", 5000);
  });

  it("explains an expired pairing code", async () => {
    const { code } = devices.registry.createPairing();
    devices.registry.authenticate(code, "someone else");
    client = new HostClient({ urls: [good], token: code });
    client.start();
    await until(() => client!.getState().status === "unauthorized", 5000);
    expect(client.getState().error).toMatch(/expired or was already used/);
  });

  it("goes to unauthorized, not offline, when revoked while connected", async () => {
    const paired = devices.registry.authenticate(devices.registry.createPairing().code, "doomed");
    if (!paired.ok) throw new Error();
    client = new HostClient({ urls: [good], token: paired.issuedToken! });
    client.start();
    await until(() => client!.getState().status === "online", 5000);
    devices.registry.revoke(paired.device.id);
    await until(() => client!.getState().status === "unauthorized", 5000);
    expect(client.getState().error).toMatch(/removed on the host/);
  });

  it("adopts the host's current addresses", async () => {
    deps.host.addresses = ["wss://relay.example/hosts/abc/connect", good];
    const saved: ConnectionSettings[] = [];
    client = new HostClient({ urls: [good], token: devices.token }, { onSettingsChange: (s) => saved.push(s) });
    client.start();
    await until(() => client!.getState().status === "online", 5000);
    expect(saved.at(-1)?.urls).toEqual(["wss://relay.example/hosts/abc/connect", good]);
    expect(client.getState().urls).toEqual(["wss://relay.example/hosts/abc/connect", good]);
  });

  it("pins the host key on first use and refuses a different one", async () => {
    const saved: ConnectionSettings[] = [];
    client = new HostClient({ urls: [good], token: devices.token }, { onSettingsChange: (s) => saved.push(s) });
    client.start();
    await until(() => client!.getState().status === "online", 5000);
    expect(saved.at(-1)?.hostKey).toBe(toHex(deps.hostKey.publicKey));
    client.stop();

    client = new HostClient({ urls: [good], token: devices.token, hostKey: toHex(generateKeyPair().publicKey) });
    client.start();
    await until(() => client!.getState().status === "unauthorized", 5000);
    expect(client.getState().error).toMatch(/identity key doesn't match/);
    expect(devices.registry.get(devices.deviceId)).not.toBeNull();
  });

  it("connects when the pinned key matches", async () => {
    client = new HostClient({ urls: [good], token: devices.token, hostKey: toHex(deps.hostKey.publicKey) });
    client.start();
    await until(() => client!.getState().status === "online", 5000);
  });

  it("reconnects after the host drops the connection", async () => {
    client = new HostClient({ urls: [good], token: devices.token });
    client.start();
    await until(() => client!.getState().status === "online", 5000);
    await server.close();
    await until(() => client!.getState().status !== "online", 5000);
    await startServer(Number(new URL(good).port));
    await until(() => client!.getState().status === "online", 8000);
  }, 15_000);

  it("keeps a live connection and replaces one that has gone quiet", async () => {
    client = new HostClient({ urls: [good], token: devices.token });
    const states: string[] = [];
    client.subscribe(() => states.push(client!.getState().status));
    client.start();
    await until(() => client!.getState().status === "online", 5000);

    // Heard from recently: just a ping, the connection stays.
    states.length = 0;
    client.checkConnection(60_000);
    await new Promise((r) => setTimeout(r, 200));
    expect(states).not.toContain("connecting");

    // Nothing heard within the limit (a socket that died without closing): start over.
    client.checkConnection(-1);
    expect(client.getState().status).toBe("connecting");
    await until(() => client!.getState().status === "online", 5000);
    await expect(client.call("agent.list")).resolves.toMatchObject({ agents: [{ pane_id: "w1:p1" }] });
  });
});
