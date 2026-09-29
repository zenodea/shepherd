import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StatusChange } from "@sheperd/protocol";
import { AgentTracker } from "./agent-tracker.ts";
import { HerdrClient } from "./herdr-client.ts";
import { FakeHerdr, fakeAgent, until } from "./testing/fake-herdr.ts";

describe("AgentTracker", () => {
  let herdr: FakeHerdr;
  let client: HerdrClient;
  let tracker: AgentTracker;
  let changes: StatusChange[];

  beforeEach(async () => {
    herdr = new FakeHerdr();
    await herdr.listen();
    client = new HerdrClient(herdr.socketPath, 500);
    tracker = new AgentTracker(client);
    changes = [];
    tracker.on("status", (c) => changes.push(c));
    tracker.on("error", () => {});
  });

  afterEach(async () => {
    tracker.stop();
    client.close();
    await herdr.close();
  });

  it("loads agents and subscribes to each pane's status", async () => {
    herdr.agents = [fakeAgent("w1:p1"), fakeAgent("w2:p1", "working")];
    await tracker.start();
    expect(tracker.list().map((a) => a.pane_id)).toEqual(["w1:p1", "w2:p1"]);
    await until(() => herdr.subscriptionsFor("pane.agent_status_changed").length === 2);
  });

  it("emits pushed status transitions with the previous status", async () => {
    herdr.agents = [fakeAgent("w1:p1", "working")];
    await tracker.start();
    await until(() => herdr.subscriptionsFor("pane.agent_status_changed").length === 1);

    herdr.setStatus("w1:p1", "blocked");
    await until(() => changes.length === 1);
    expect(changes[0]).toMatchObject({ paneId: "w1:p1", status: "blocked", previous: "working" });
    expect(tracker.get("w1:p1")?.agent_status).toBe("blocked");
  });

  it("does not emit duplicates when a refresh confirms a pushed status", async () => {
    herdr.agents = [fakeAgent("w1:p1", "working")];
    await tracker.start();
    await until(() => herdr.subscriptionsFor("pane.agent_status_changed").length === 1);

    herdr.setStatus("w1:p1", "done");
    await until(() => changes.length === 1);
    await tracker.refresh();
    expect(changes).toHaveLength(1);
  });

  it("picks up new agents on lifecycle events and resubscribes", async () => {
    herdr.agents = [fakeAgent("w1:p1")];
    await tracker.start();
    await until(() => herdr.subscriptionsFor("pane.agent_status_changed").length === 1);

    herdr.agents = [...herdr.agents, fakeAgent("w3:p1", "working")];
    herdr.push("pane.agent_detected", { type: "pane.agent_detected", pane_id: "w3:p1" });
    await until(() => tracker.get("w3:p1") !== null);
    await until(() =>
      herdr.subscriptionsFor("pane.agent_status_changed").some((s) => s.pane_id === "w3:p1"),
    );
  });

  it("reports transitions missed between subscriptions via refresh diffs", async () => {
    herdr.agents = [fakeAgent("w1:p1", "working")];
    await tracker.start();

    herdr.setStatus("w1:p1", "idle", { push: false });
    await tracker.refresh();
    expect(changes).toMatchObject([{ paneId: "w1:p1", status: "idle", previous: "working" }]);
  });

  it("reconnects after herdr restarts", async () => {
    herdr.agents = [fakeAgent("w1:p1", "working")];
    await tracker.start();
    await until(() => herdr.subscriptionsFor("pane.agent_status_changed").length === 1);

    herdr.disconnectAll();
    herdr.setStatus("w1:p1", "done", { push: false });
    await until(() => changes.length === 1, 4000);
    expect(changes[0]).toMatchObject({ status: "done", previous: "working" });
  });
});
