import { describe, expect, it } from "vitest";
import type { AgentInfo } from "@shepherd/protocol";
import type { HostState } from "../connection/host-client";
import { widgetSummary } from "./widget";

const agent = (pane_id: string, agent_status: AgentInfo["agent_status"], title: string) =>
  ({ pane_id, agent: "claude", agent_status, terminal_title_stripped: title }) as AgentInfo;
const state = (agents: AgentInfo[], status: HostState["status"] = "online") =>
  ({ status, host: { name: "studio", herdrVersion: "0.9.1" }, agents }) as HostState;

describe("widgetSummary", () => {
  it("leads with what needs you, then what's working", () => {
    const summary = widgetSummary(
      state([agent("w1:p1", "working", "Refactor"), agent("w1:p2", "blocked", "Fix login"), agent("w1:p3", "idle", "Docs"), agent("w1:p4", "done", "Bump deps")]),
      "studio",
      1,
    );
    expect(summary).toEqual({
      title: "Shepherd · studio",
      summary: "1 needs you · 1 working",
      tone: "blocked",
      lines: [
        { text: "claude · Fix login", status: "blocked" },
        { text: "claude · Bump deps", status: "done" },
        { text: "claude · Refactor", status: "working" },
      ],
      at: 1,
    });
  });

  it("says when there's nothing to say", () => {
    expect(widgetSummary(state([agent("w1:p1", "idle", "x")]), "studio").summary).toBe("All quiet");
    expect(widgetSummary(state([], "offline"), "studio").summary).toBe("Not connected");
    expect(widgetSummary(state([]), null).summary).toBe("Open Shepherd to pair");
  });
});
