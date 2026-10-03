import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityLog, MAX_ENTRIES } from "./activity-log.ts";
import { AgentTracker } from "./agent-tracker.ts";
import type { HerdrClient } from "./herdr-client.ts";
import { fakeAgent } from "../testing/fake-herdr.ts";

const tracker = () => new AgentTracker({} as HerdrClient);

describe("ActivityLog", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("records status changes, starts and closes, newest first", () => {
    let now = 1000;
    const log = new ActivityLog({ now: () => now++ });
    const t = tracker();
    t.apply([fakeAgent("w1:p1", "working")]);
    log.attach(t);

    t.apply([fakeAgent("w1:p1", "blocked")]);
    t.apply([fakeAgent("w1:p1", "blocked"), fakeAgent("w2:p1", "idle")]);
    t.apply([fakeAgent("w2:p1", "idle")]);

    const { entries } = log.page();
    expect(entries.map((e) => [e.paneId, e.event, e.previous])).toEqual([
      ["w1:p1", "closed", "blocked"],
      ["w2:p1", "started", null],
      ["w1:p1", "blocked", "working"],
    ]);
    expect(entries[0]!.at).toBeGreaterThan(entries[2]!.at);
  });

  it("knows when each agent last finished, and forgets it when the pane is reused", () => {
    let now = 1000;
    const log = new ActivityLog({ now: () => now++ });
    const t = tracker();
    t.apply([fakeAgent("w1:p1", "working"), fakeAgent("w1:p2", "idle")]);
    log.attach(t);
    expect(log.lastFinished("w1:p1")).toBeNull();

    t.apply([fakeAgent("w1:p1", "done"), fakeAgent("w1:p2", "idle")]);
    const finished = log.lastFinished("w1:p1");
    expect(finished).not.toBeNull();
    // Looking at it (done → idle) isn't finishing again; working → idle (watched as it finished) is.
    t.apply([fakeAgent("w1:p1", "idle"), fakeAgent("w1:p2", "idle")]);
    expect(log.lastFinished("w1:p1")).toBe(finished);
    t.apply([fakeAgent("w1:p1", "working"), fakeAgent("w1:p2", "idle")]);
    t.apply([fakeAgent("w1:p1", "idle"), fakeAgent("w1:p2", "idle")]);
    expect(log.lastFinished("w1:p1")).toBeGreaterThan(finished!);
    expect(log.lastFinished("w1:p2")).toBeNull();

    // The pane closes and herdr reuses its id for a new agent.
    t.apply([fakeAgent("w1:p2", "idle")]);
    t.apply([fakeAgent("w1:p1", "idle"), fakeAgent("w1:p2", "idle")]);
    expect(log.lastFinished("w1:p1")).toBeNull();
  });

  it("does not report agents that were already running as started", () => {
    const log = new ActivityLog();
    const t = tracker();
    t.apply([fakeAgent("w1:p1")]);
    log.attach(t);
    t.apply([fakeAgent("w1:p1")]);
    expect(log.page().entries).toEqual([]);
  });

  it("skips herdr's unknown state", () => {
    const log = new ActivityLog();
    const t = tracker();
    t.apply([fakeAgent("w1:p1", "unknown")]);
    log.attach(t);
    t.apply([fakeAgent("w1:p1", "idle")]);
    t.apply([fakeAgent("w1:p1", "unknown")]);
    expect(log.page().entries).toEqual([]);
  });

  it("pages backwards and caps the page size", () => {
    const log = new ActivityLog();
    const t = tracker();
    t.apply([fakeAgent("w1:p1", "idle")]);
    log.attach(t);
    for (let i = 0; i < 10; i++) t.apply([fakeAgent("w1:p1", i % 2 ? "idle" : "working")]);
    const first = log.page({ limit: 4 }).entries;
    expect(first.map((e) => e.id)).toEqual([10, 9, 8, 7]);
    expect(log.page({ before: 7, limit: 4 }).entries.map((e) => e.id)).toEqual([6, 5, 4, 3]);
    expect(log.page({ limit: 10_000 }).entries).toHaveLength(10);
  });

  it("keeps the newest entries and survives a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "shepherd-activity-"));
    dirs.push(dir);
    const path = join(dir, "activity.json");
    const log = new ActivityLog({ path });
    const t = tracker();
    t.apply([fakeAgent("w1:p1", "idle")]);
    log.attach(t);
    for (let i = 0; i < MAX_ENTRIES + 5; i++) t.apply([fakeAgent("w1:p1", i % 2 ? "idle" : "working")]);
    log.flush();

    const reloaded = new ActivityLog({ path });
    const newest = reloaded.page({ limit: 1 }).entries[0]!;
    expect(newest.id).toBe(MAX_ENTRIES + 5);
    expect(reloaded.page({ limit: 200, before: 7 }).entries).toHaveLength(1);
  });
});
