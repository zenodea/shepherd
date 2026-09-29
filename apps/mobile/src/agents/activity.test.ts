import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "@shepherd/protocol";
import { awaySummary, dayLabel, durations, entryVerb, formatDuration, groupByDay } from "./activity";

const MIN = 60_000;
let nextId = 1;
function entry(event: ActivityEntry["event"], at: number, previous: ActivityEntry["previous"] = null, paneId = "w1:p1"): ActivityEntry {
  return { id: nextId++, at, event, previous, paneId, workspaceId: "w1", agent: "claude", name: null, title: null, cwd: null };
}

describe("activity", () => {
  it("describes entries", () => {
    expect(entryVerb(entry("blocked", 0))).toBe("needs input");
    expect(entryVerb(entry("working", 0, "blocked"))).toBe("got your answer");
    expect(entryVerb(entry("working", 0, "idle"))).toBe("started working");
  });

  it("formats durations", () => {
    expect(formatDuration(20_000)).toBe("under a minute");
    expect(formatDuration(12 * MIN)).toBe("12m");
    expect(formatDuration(90 * MIN)).toBe("1h 30m");
    expect(formatDuration(120 * MIN)).toBe("2h");
  });

  it("works out how long an agent waited and worked", () => {
    const working = entry("working", 0, "idle");
    const blocked = entry("blocked", 10 * MIN, "working");
    const other = entry("working", 11 * MIN, "idle", "w2:p1");
    const answered = entry("working", 40 * MIN, "blocked");
    const done = entry("done", 55 * MIN, "working");
    const d = durations([done, answered, other, blocked, working]);
    expect(d.get(blocked.id)).toBe("waited 30m");
    expect(d.get(done.id)).toBe("after 15m");
    expect(d.has(other.id)).toBe(false);
  });

  it("marks a prompt nobody has answered yet", () => {
    const blocked = entry("blocked", 0, "working");
    expect(durations([blocked]).get(blocked.id)).toBe("waiting");
  });

  it("groups by day and summarises time away", () => {
    const now = new Date(2026, 8, 29, 18, 0).getTime();
    const yesterday = entry("blocked", now - 26 * 60 * MIN, "working");
    const today = entry("done", now - 60 * MIN, "working");
    expect(dayLabel(today.at, now)).toBe("Today");
    expect(groupByDay([today, yesterday], now).map((g) => [g.day, g.entries.length])).toEqual([
      ["Today", 1],
      ["Yesterday", 1],
    ]);
    expect(awaySummary([today, yesterday], yesterday.id)).toBe("1 finished");
    expect(awaySummary([today], today.id)).toBeNull();
  });
});
