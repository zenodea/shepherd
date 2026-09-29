import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HerdrPushedEvent } from "@sheperd/protocol";
import { HerdrClient, HerdrRequestError, defaultSocketPath, lineReader } from "./herdr-client.ts";
import { FakeHerdr, fakeAgent, until } from "./testing/fake-herdr.ts";

describe("lineReader", () => {
  it("reassembles lines split across chunks and skips blanks", () => {
    const lines: string[] = [];
    const feed = lineReader((l) => lines.push(l));
    feed('{"a":');
    feed('1}\n\n{"b"');
    feed(":2}\n");
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe("defaultSocketPath", () => {
  it("prefers HERDR_SOCKET_PATH, then named sessions, then the default", () => {
    expect(defaultSocketPath({ HERDR_SOCKET_PATH: "/x.sock" })).toBe("/x.sock");
    expect(defaultSocketPath({ XDG_CONFIG_HOME: "/cfg", HERDR_SESSION: "agents" })).toBe(
      "/cfg/herdr/sessions/agents/herdr.sock",
    );
    expect(defaultSocketPath({ XDG_CONFIG_HOME: "/cfg" })).toBe("/cfg/herdr/herdr.sock");
  });
});

describe("HerdrClient", () => {
  let herdr: FakeHerdr;
  let client: HerdrClient;

  beforeEach(async () => {
    herdr = new FakeHerdr();
    await herdr.listen();
    client = new HerdrClient(herdr.socketPath, 500);
  });

  afterEach(async () => {
    client.close();
    await herdr.close();
  });

  it("matches concurrent responses to requests", async () => {
    herdr.agents = [fakeAgent("w1:p1")];
    const [pong, list] = await Promise.all([
      client.request<{ type: string }>("ping"),
      client.request<{ agents: unknown[] }>("agent.list"),
    ]);
    expect(pong.type).toBe("pong");
    expect(list.agents).toHaveLength(1);
  });

  it("rejects with the herdr error code", async () => {
    await expect(client.request("nope")).rejects.toMatchObject({ code: "unknown_method" });
    await expect(client.request("nope")).rejects.toBeInstanceOf(HerdrRequestError);
  });

  it("fails pending requests when the socket drops, then reconnects", async () => {
    herdr.handlers["slow"] = () => new Promise(() => {});
    const slow = client.request("slow");
    await until(() => herdr.requests.some((r) => r.method === "slow"));
    herdr.disconnectAll();
    await expect(slow).rejects.toMatchObject({ code: "disconnected" });
    await expect(client.request("ping")).resolves.toMatchObject({ type: "pong" });
  });

  it("delivers pushed events after the subscription is acknowledged", async () => {
    const events: HerdrPushedEvent[] = [];
    const sub = await client.subscribe([{ type: "pane.agent_status_changed", pane_id: "w1:p1" }], (e) => events.push(e));
    herdr.push("pane.agent_status_changed", { pane_id: "w1:p1", workspace_id: "w1", agent_status: "blocked" });
    herdr.push("pane.agent_status_changed", { pane_id: "w2:p1", workspace_id: "w2", agent_status: "done" });
    await until(() => events.length === 1);
    expect(events[0]).toEqual({
      event: "pane.agent_status_changed",
      data: { pane_id: "w1:p1", workspace_id: "w1", agent_status: "blocked" },
    });
    sub.close();
    await sub.closed;
  });
});
