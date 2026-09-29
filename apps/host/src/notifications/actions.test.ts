import { describe, expect, it, vi } from "vitest";
import type { BlockedPrompt } from "@sheperd/protocol";
import { ACTION_TTL_MS, NotificationActions, promptFingerprint } from "./actions.ts";

const PROMPT: BlockedPrompt = {
  lines: ["Do you want to make this edit to login.test.ts?"],
  options: [
    { key: "1", label: "Yes", selected: true },
    { key: "shift+tab", label: "Yes, allow all edits during this session", selected: false },
    { key: "esc", label: "No, and tell Claude what to do differently", selected: false },
    { key: "4", label: "Something else", selected: false },
  ],
};

function setup(overrides: { prompt?: BlockedPrompt | null; blocked?: boolean } = {}) {
  let now = 1_000_000;
  const sent: [string, string][] = [];
  const state = { prompt: overrides.prompt === undefined ? PROMPT : overrides.prompt, blocked: overrides.blocked ?? true };
  const actions = new NotificationActions({
    server: "https://ntfy.example/",
    topic: "sheperd-topic",
    secret: new Uint8Array(32).fill(7),
    readPrompt: async () => state.prompt,
    isBlocked: () => state.blocked,
    sendKey: async (paneId, key) => void sent.push([paneId, key]),
    now: () => now,
  });
  return { actions, sent, state, tick: (ms: number) => (now += ms) };
}

describe("NotificationActions", () => {
  it("makes up to three buttons that post to the reply topic", () => {
    const { actions } = setup();
    const buttons = actions.buttons("w1:p1", PROMPT);
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.label)).toEqual(["Yes", "Yes, allow all edits du…", "No, and tell Claude wha…"]);
    expect(buttons[0]).toMatchObject({ action: "http", method: "POST", clear: true, url: `https://ntfy.example/${actions.replyTopic}` });
    expect(actions.replyTopic).toMatch(/^sheperd-r-[A-Za-z0-9_-]{22}$/);
    expect(actions.replyTopic).not.toContain("sheperd-topic");
  });

  it("presses the option's key when the same question is still showing", async () => {
    const { actions, sent } = setup();
    const [, allowAll] = actions.buttons("w1:p1", PROMPT);
    expect(await actions.handle(allowAll!.body)).toEqual({ ok: true, paneId: "w1:p1", label: PROMPT.options[1]!.label });
    expect(sent).toEqual([["w1:p1", "shift+tab"]]);
  });

  it("works only once per button", async () => {
    const { actions, sent } = setup();
    const [yes] = actions.buttons("w1:p1", PROMPT);
    await actions.handle(yes!.body);
    expect(await actions.handle(yes!.body)).toMatchObject({ ok: false, reason: "used" });
    expect(sent).toHaveLength(1);
  });

  it("refuses forged, tampered and foreign tokens", async () => {
    const { actions, sent } = setup();
    const [yes] = actions.buttons("w1:p1", PROMPT);
    const [body, mac] = yes!.body.split(".");
    const payload = JSON.parse(Buffer.from(body!, "base64url").toString());
    const tampered = `${Buffer.from(JSON.stringify({ ...payload, k: "ctrl+c" })).toString("base64url")}.${mac}`;
    const other = new NotificationActions({ ...setup().actions["opts"], secret: new Uint8Array(32).fill(8) });
    for (const token of ["", "garbage", tampered, other.buttons("w1:p1", PROMPT)[0]!.body]) {
      expect(await actions.handle(token)).toMatchObject({ ok: false, reason: "invalid" });
    }
    expect(sent).toEqual([]);
  });

  it("refuses expired buttons", async () => {
    const { actions, sent, tick } = setup();
    const [yes] = actions.buttons("w1:p1", PROMPT);
    tick(ACTION_TTL_MS + 1);
    expect(await actions.handle(yes!.body)).toMatchObject({ ok: false, reason: "expired" });
    expect(sent).toEqual([]);
  });

  it("does nothing once the agent has moved on or asks something else", async () => {
    const { actions, sent, state } = setup();
    const [yes, allowAll] = actions.buttons("w1:p1", PROMPT);
    state.prompt = { ...PROMPT, lines: ["Do you want to run rm -rf build?"] };
    expect(await actions.handle(yes!.body)).toMatchObject({ ok: false, reason: "changed" });
    state.blocked = false;
    expect(await actions.handle(allowAll!.body)).toMatchObject({ ok: false, reason: "not_blocked" });
    expect(sent).toEqual([]);
  });

  it("fingerprints the question and options, not which one is highlighted", () => {
    const moved = { ...PROMPT, options: PROMPT.options.map((o, i) => ({ ...o, selected: i === 2 })) };
    expect(promptFingerprint(moved)).toBe(promptFingerprint(PROMPT));
    expect(promptFingerprint({ ...PROMPT, lines: ["Other?"] })).not.toBe(promptFingerprint(PROMPT));
  });

  it("listens to the reply topic and resumes after the last message", async () => {
    const { actions, sent } = setup();
    const [yes] = actions.buttons("w1:p1", PROMPT);
    const urls: string[] = [];
    const lines = [{ event: "open" }, { id: "m1", event: "message", message: yes!.body }].map((e) => JSON.stringify(e) + "\n");
    const fetch = vi.fn(async (url: string) => {
      urls.push(url);
      if (urls.length > 1) {
        listening.stop();
        throw new Error("stopped");
      }
      return {
        ok: true,
        status: 200,
        body: (async function* () {
          for (const line of lines) yield new TextEncoder().encode(line);
        })(),
      };
    });
    const listening = new NotificationActions({ ...actions["opts"], fetch, onError: () => {} });
    listening.start();
    await vi.waitFor(() => expect(urls.length).toBe(2), { timeout: 3000 });
    expect(sent).toEqual([["w1:p1", "1"]]);
    expect(urls[0]).toBe(`https://ntfy.example/${actions.replyTopic}/json`);
    expect(urls[1]).toBe(`https://ntfy.example/${actions.replyTopic}/json?since=m1`);
    listening.stop();
  });
});
