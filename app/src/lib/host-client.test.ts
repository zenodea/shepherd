// Runs the app's HostClient in Node against a real host server. The `ws`
// package's WebSocket takes (url, protocols, { headers }) like React Native's.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { AgentTracker } from "../../../host/src/agent-tracker";
import { HerdrClient } from "../../../host/src/herdr-client";
import { startLocalServer, type LocalServer } from "../../../host/src/server";
import { FakeHerdr, fakeAgent, until } from "../../../host/src/testing/fake-herdr";
import { HostClient } from "./host-client";

(globalThis as { WebSocket: unknown }).WebSocket = WebSocket;

const TOKEN = "app-test-token";
// Nothing listens here, so connections are refused straight away.
const DEAD = "ws://127.0.0.1:9/connect";

describe("HostClient", () => {
  let herdr: FakeHerdr;
  let herdrClient: HerdrClient;
  let tracker: AgentTracker;
  let server: LocalServer;
  let good: string;
  let client: HostClient | null = null;

  beforeAll(async () => {
    herdr = new FakeHerdr();
    await herdr.listen();
    herdr.agents = [fakeAgent("w1:p1", "blocked")];
    herdrClient = new HerdrClient(herdr.socketPath, 1000);
    tracker = new AgentTracker(herdrClient);
    tracker.on("error", () => {});
    await tracker.start();
    server = await startLocalServer({
      port: 0,
      bind: "127.0.0.1",
      token: TOKEN,
      deps: {
        herdr: herdrClient,
        tracker,
        host: { name: "test-host", herdrVersion: "fake" },
        openTerminal: () => {
          throw new Error("unused");
        },
      },
    });
    good = `ws://127.0.0.1:${server.port}/connect`;
  });

  afterEach(() => {
    client?.stop();
    client = null;
  });

  afterAll(async () => {
    await server.close();
    tracker.stop();
    herdrClient.close();
    await herdr.close();
  });

  it("uses whichever address answers when others are dead", async () => {
    client = new HostClient({ urls: [DEAD, good], token: TOKEN });
    client.start();
    await until(() => client!.getState().status === "online", 5000);
    expect(client.getState()).toMatchObject({
      activeUrl: good,
      host: { name: "test-host" },
      agents: [{ pane_id: "w1:p1", agent_status: "blocked" }],
    });
  });

  it("forwards calls once online", async () => {
    herdr.handlers["agent.prompt"] = (params) => ({ type: "ok", params });
    client = new HostClient({ urls: [good], token: TOKEN });
    client.start();
    await until(() => client!.getState().status === "online", 5000);
    await expect(client.call("agent.prompt", { target: "w1:p1", text: "hi" })).resolves.toEqual({
      type: "ok",
      params: { target: "w1:p1", text: "hi" },
    });
  });

  it("reports offline when no address answers", async () => {
    client = new HostClient({ urls: [DEAD], token: TOKEN });
    client.start();
    await until(() => client!.getState().status === "offline", 5000);
    await expect(client.call("agent.list")).rejects.toMatchObject({ code: "offline" });
  });

  it("stops retrying when the token is rejected", async () => {
    client = new HostClient({ urls: [good], token: "wrong" });
    client.start();
    await until(() => client!.getState().status === "unauthorized", 5000);
  });

  it("reconnects after the host drops the connection", async () => {
    client = new HostClient({ urls: [good], token: TOKEN });
    client.start();
    await until(() => client!.getState().status === "online", 5000);
    await server.close();
    await until(() => client!.getState().status !== "online", 5000);
    server = await startLocalServer({
      port: Number(new URL(good).port),
      bind: "127.0.0.1",
      token: TOKEN,
      deps: {
        herdr: herdrClient,
        tracker,
        host: { name: "test-host", herdrVersion: "fake" },
        openTerminal: () => {
          throw new Error("unused");
        },
      },
    });
    await until(() => client!.getState().status === "online", 8000);
  }, 15_000);
});
