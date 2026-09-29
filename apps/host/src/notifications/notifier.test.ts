import { describe, expect, it } from "vitest";
import type { StatusChange } from "@sheperd/protocol";
import { NotificationActions } from "./actions.ts";
import { Notifier, notificationFor, ntfySubscribeUrl, type NtfyMessage } from "./notifier.ts";
import { fakeAgent } from "../testing/fake-herdr.ts";

const change = (status: StatusChange["status"], previous: StatusChange["previous"]): StatusChange => ({
  type: "agent.status",
  paneId: "w1:p1",
  status,
  previous,
  agent: fakeAgent("w1:p1", status, { agent: "claude", terminal_title_stripped: "Fix login bug" }),
});

describe("notificationFor", () => {
  it("notifies loudly when an agent needs input", () => {
    expect(notificationFor(change("blocked", "working"), "laptop", "topic")).toEqual({
      topic: "topic",
      title: "claude needs input",
      message: "Fix login bug · laptop",
      priority: 4,
      tags: ["raising_hand"],
      click: "sheperd://agent/w1%3Ap1",
    });
  });

  it("notifies when a working agent finishes", () => {
    expect(notificationFor(change("done", "working"), "laptop", "t")).toMatchObject({ title: "claude finished", priority: 3 });
  });

  it("links to this computer when given a host id", () => {
    expect(notificationFor(change("blocked", "working"), "laptop", "t", "0123456789abcdef")?.click).toBe("sheperd://agent/w1%3Ap1?host=0123456789abcdef");
  });

  it("stays quiet for other transitions", () => {
    expect(notificationFor(change("working", "idle"), "laptop", "t")).toBeNull();
    expect(notificationFor(change("idle", "working"), "laptop", "t")).toBeNull();
    expect(notificationFor(change("done", "idle"), "laptop", "t")).toBeNull();
  });
});

describe("Notifier", () => {
  it("publishes JSON to the server and rate-limits repeats per pane", async () => {
    const sent: { url: string; body: NtfyMessage }[] = [];
    const notifier = new Notifier({
      config: { server: "https://ntfy.example/", topic: "sheperd-abc" },
      hostName: "laptop",
      fetch: async (url, init) => {
        sent.push({ url, body: JSON.parse(init.body) });
        return { ok: true, status: 200 };
      },
    });
    await notifier.handle(change("blocked", "working"));
    await notifier.handle(change("blocked", "working"));
    await notifier.handle(change("done", "working"));
    expect(sent.map((s) => s.url)).toEqual(["https://ntfy.example", "https://ntfy.example"]);
    expect(sent.map((s) => s.body.title)).toEqual(["claude needs input", "claude finished"]);
    expect(sent[0]!.body.topic).toBe("sheperd-abc");
  });

  it("puts a blocked agent's question in the body and its options on buttons", async () => {
    const sent: NtfyMessage[] = [];
    const prompt = {
      lines: ["Edit file", "Do you want to make this edit?"],
      options: [
        { key: "1", label: "Yes", selected: true },
        { key: "esc", label: "No", selected: false },
      ],
    };
    const actions = new NotificationActions({
      server: "https://ntfy.example",
      topic: "sheperd-abc",
      secret: new Uint8Array(32),
      readPrompt: async () => prompt,
      isBlocked: () => true,
      sendKey: async () => {},
    });
    const notifier = new Notifier({
      config: { server: "https://ntfy.example", topic: "sheperd-abc" },
      hostName: "laptop",
      prompts: { read: async () => prompt, actions },
      fetch: async (_url, init) => {
        sent.push(JSON.parse(init.body));
        return { ok: true, status: 200 };
      },
    });
    await notifier.handle(change("blocked", "working"));
    expect(sent[0]!.message).toBe("Edit file\nDo you want to make this edit?\nFix login bug · laptop");
    expect(sent[0]!.actions?.map((a) => a.label)).toEqual(["Yes", "No"]);
    expect(await actions.handle(sent[0]!.actions![1]!.body)).toMatchObject({ ok: true, label: "No" });
  });

  it("reports publish failures without throwing", async () => {
    const errors: Error[] = [];
    const notifier = new Notifier({
      config: { server: "https://ntfy.example", topic: "t" },
      hostName: "laptop",
      fetch: async () => ({ ok: false, status: 429 }),
      onError: (e) => errors.push(e),
    });
    await notifier.handle(change("blocked", "working"));
    expect(errors.map((e) => e.message)).toEqual(["ntfy responded 429"]);
  });
});

describe("ntfySubscribeUrl", () => {
  it("builds the ntfy app deep link", () => {
    expect(ntfySubscribeUrl({ server: "https://ntfy.sh", topic: "sheperd-abc" })).toBe("ntfy://ntfy.sh/sheperd-abc?display=sheperd");
    expect(ntfySubscribeUrl({ server: "http://10.0.0.2:8080/", topic: "t" })).toBe("ntfy://10.0.0.2:8080/t?display=sheperd&secure=false");
  });
});
