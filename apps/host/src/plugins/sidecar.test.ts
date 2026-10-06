import { describe, expect, it } from "vitest";
import { SidecarError, parseSidecar } from "./sidecar.ts";

describe("parseSidecar", () => {
  it("reads cards with their defaults", () => {
    const sidecar = parseSidecar(`
schema = 1

[[cards]]
id = "pen"
title = " Pen "
command = ["node", "src/cli.ts", "card"]

[[cards]]
id = "changes"
title = "Changes"
context = "workspace"
command = ["./card.sh"]
refresh = 30
timeout = 120
`);
    expect(sidecar).toEqual({
      schema: 1,
      actions: true,
      cards: [
        { id: "pen", title: "Pen", context: "pane", command: ["node", "src/cli.ts", "card"], refresh: "status", timeoutMs: 10_000 },
        { id: "changes", title: "Changes", context: "workspace", command: ["./card.sh"], refresh: 30, timeoutMs: 60_000 },
      ],
    });
    expect(parseSidecar("actions = false")).toEqual({ schema: 1, actions: false, cards: [] });
  });

  it("says what's wrong and where", () => {
    const bad = (text: string) => expect(() => parseSidecar(text)).toThrow(SidecarError);
    bad("[[cards]\nid = 1");
    bad('[[cards]]\ntitle = "No id"\ncommand = ["x"]');
    bad('[[cards]]\nid = "a"\ncommand = ["x"]');
    bad('[[cards]]\nid = "a"\ntitle = "A"');
    bad('[[cards]]\nid = "a"\ntitle = "A"\ncommand = []');
    bad('[[cards]]\nid = "a"\ntitle = "A"\ncommand = ["x"]\ncontext = "tab"');
    bad('[[cards]]\nid = "a"\ntitle = "A"\ncommand = ["x"]\nrefresh = "never"');
    bad('[[cards]]\nid = "a"\ntitle = "A"\ncommand = ["x"]\n[[cards]]\nid = "a"\ntitle = "B"\ncommand = ["y"]');
    expect(() => parseSidecar("schema = 2")).toThrow(/newer Shepherd/);
    expect(() => parseSidecar('[[cards]]\nid = "a"\ntitle = "A"\ncommand = ["x"]\ncontext = "tab"')).toThrow(/cards\[0\] \("a"\): "context"/);
  });
});
