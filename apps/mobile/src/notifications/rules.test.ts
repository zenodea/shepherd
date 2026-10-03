import { describe, expect, it } from "vitest";
import type { AgentInfo, StatusChange } from "@shepherd/protocol";
import { Cooldown, alertFor, excerpt, missedChanges, questionText, stillOffered, withPrompt } from "./rules";

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
    // Answered elsewhere while the phone was away, then it finished.
    expect(alertFor(change("done", "blocked"), "studio")?.title).toBe("claude finished");
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

describe("answers you write and finished replies", () => {
  it("turns a write-your-own option into the Reply box, leaving two buttons", () => {
    const prompt = {
      lines: ["Which database?"],
      options: [
        { key: "1", label: "Postgres", selected: true },
        { key: "2", label: "SQLite", selected: false },
        { key: "3", label: "MySQL", selected: false },
        { key: "4", label: "Type something.", selected: false, input: true },
      ],
    };
    const { actions, write } = withPrompt(alertFor(change("blocked", "working"), "studio")!, prompt);
    expect(actions.map((a) => a.label)).toEqual(["Postgres", "SQLite"]);
    expect(write).toEqual({ key: "4", label: "Type something." });
  });

  it("excerpts the last reply as plain text", () => {
    expect(excerpt("Fixed. The test now **waits** for `flush`.\n\n```ts\ncode\n```")).toBe("Fixed. The test now waits for flush.");
    const long = `${"word ".repeat(30)}end. ${"more ".repeat(30)}`;
    expect(excerpt(long).length).toBeLessThanOrEqual(181);
    expect(excerpt(long).endsWith("…") || excerpt(long).endsWith(".")).toBe(true);
  });
});

describe("questionText", () => {
  it("keeps the question, not Claude's tab bar or tool output around it", () => {
    const prompt = {
      lines: ["⏺ Before I start, one decision.", "←  ☐ Database  ✔ Submit  →", "Which database should the cache use?"],
      options: [{ key: "1", label: "Postgres", selected: true }],
    };
    expect(questionText(prompt)).toBe("Which database should the cache use?");
  });
});

describe("missedChanges", () => {
  it("finds what changed while the phone was disconnected", () => {
    const a = (pane_id: string, agent_status: AgentInfo["agent_status"]) => ({ ...agent, pane_id, agent_status }) as AgentInfo;
    const before = new Map([["w1:p1", a("w1:p1", "working")], ["w1:p2", a("w1:p2", "idle")], ["w1:p3", a("w1:p3", "working")]]);
    const changes = missedChanges(before, [a("w1:p1", "done"), a("w1:p2", "idle"), a("w1:p3", "blocked"), a("w1:p4", "working")]);
    expect(changes.map((c) => `${c.paneId}:${c.previous}→${c.status}`)).toEqual(["w1:p1:working→done", "w1:p3:working→blocked"]);
  });
});
