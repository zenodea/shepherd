import { describe, expect, it } from "vitest";
import type { AgentInfo, StatusChange } from "@shepherd/protocol";
import { Cooldown, alertFor, stillOffered, withPrompt } from "./rules";

const agent = { agent: "claude", pane_id: "w1:p1", terminal_title_stripped: "Fix login test" } as AgentInfo;
const change = (status: StatusChange["status"], previous: StatusChange["previous"]): StatusChange => ({ type: "agent.status", paneId: "w1:p1", status, previous, agent });

describe("alertFor", () => {
  it("notifies when an agent needs input or finishes working", () => {
    expect(alertFor(change("blocked", "working"), "studio")).toEqual({ paneId: "w1:p1", kind: "blocked", title: "claude needs input", body: "Fix login test · studio" });
    expect(alertFor(change("done", "working"), "studio")?.title).toBe("claude finished");
  });

  it("stays quiet otherwise", () => {
    expect(alertFor(change("working", "idle"), "studio")).toBeNull();
    expect(alertFor(change("done", "idle"), "studio")).toBeNull();
    expect(alertFor(change("blocked", "blocked"), "studio")).toBeNull();
  });
});

describe("prompts on notifications", () => {
  const prompt = {
    lines: ["Edit file", "Do you want to make this edit?"],
    options: [
      { key: "1", label: "Yes", selected: true },
      { key: "2", label: "Yes, and don't ask again", selected: false },
      { key: "3", label: "No", selected: false },
      { key: "esc", label: "Cancel", selected: false },
    ],
  };

  it("shows the question and up to three answers", () => {
    const { alert, actions } = withPrompt(alertFor(change("blocked", "working"), "studio")!, prompt);
    expect(alert.body).toBe("Edit file\nDo you want to make this edit?\nFix login test · studio");
    expect(actions.map((a) => a.label)).toEqual(["Yes", "Yes, and don't ask again", "No"]);
  });

  it("only answers if the same question is still on screen", () => {
    expect(stillOffered(prompt, { key: "1", label: "Yes" })).toBe(true);
    expect(stillOffered({ ...prompt, options: [{ key: "1", label: "Allow", selected: true }] }, { key: "1", label: "Yes" })).toBe(false);
    expect(stillOffered(null, { key: "1", label: "Yes" })).toBe(false);
  });
});

describe("Cooldown", () => {
  it("lets the same key through once per period", () => {
    let t = 0;
    const cooldown = new Cooldown(1000, () => t);
    expect(cooldown.allow("a")).toBe(true);
    expect(cooldown.allow("a")).toBe(false);
    expect(cooldown.allow("b")).toBe(true);
    t = 1000;
    expect(cooldown.allow("a")).toBe(true);
  });
});
