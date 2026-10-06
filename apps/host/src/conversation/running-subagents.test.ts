import { describe, expect, it } from "vitest";
import type { AgentInfo, Subagent, SubagentStatus } from "@shepherd/protocol";
import { fakeAgent } from "../testing/fake-herdr.ts";
import { RunningSubagents } from "./running-subagents.ts";

const sub = (status: SubagentStatus) => ({ status }) as Subagent;

describe("RunningSubagents", () => {
  it("counts running subagents of agents that aren't working, and says when that changes", () => {
    let agents: AgentInfo[] = [fakeAgent("w1:p1", "done"), fakeAgent("w1:p2", "working")];
    let statuses: SubagentStatus[] = ["running", "running", "done"];
    let asked = 0;
    const running = new RunningSubagents(
      () => {
        asked++;
        return { available: true, subagents: statuses.map(sub) };
      },
      () => agents,
    );

    running.check();
    expect(asked).toBe(0); // nobody listening: no work

    let changes = 0;
    running.on("changed", () => changes++);
    running.check();
    expect([running.count("w1:p1"), running.count("w1:p2"), changes]).toEqual([2, 0, 1]);

    running.check();
    expect(changes).toBe(1);

    statuses = ["done"];
    running.check();
    expect([running.count("w1:p1"), changes]).toEqual([0, 2]);

    agents = [fakeAgent("w1:p1", "working")];
    statuses = ["running"];
    running.check();
    expect([running.count("w1:p1"), changes]).toEqual([0, 2]);
  });
});
