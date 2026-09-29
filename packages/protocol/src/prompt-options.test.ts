import { describe, expect, it } from "vitest";
import { extractPrompt } from "./prompt-options.ts";

describe("extractPrompt", () => {
  it("reads a Claude Code style permission prompt", () => {
    const screen = [
      "⏺ Update(src/app.ts)",
      "  ⎿  Updated src/app.ts with 2 additions",
      "",
      "╭──────────────────────────────────────────────╮",
      "│ Edit file                                    │",
      "│ Do you want to make this edit to app.ts?     │",
      "│ ❯ 1. Yes                                     │",
      "│   2. Yes, allow all edits during this session (shift+tab) │",
      "│   3. No, and tell Claude what to do differently (esc) │",
      "╰──────────────────────────────────────────────╯",
      "",
    ].join("\n");
    expect(extractPrompt(screen)).toEqual({
      lines: ["⎿  Updated src/app.ts with 2 additions", "Edit file", "Do you want to make this edit to app.ts?"],
      options: [
        { key: "1", label: "Yes", selected: true },
        { key: "shift+tab", label: "Yes, allow all edits during this session", selected: false },
        { key: "esc", label: "No, and tell Claude what to do differently", selected: false },
      ],
    });
  });

  it("uses shortcut letters from Codex style prompts", () => {
    const screen = [
      "  Would you like to run the following command?",
      "",
      "  $ npm test",
      "",
      "› 1. Yes, proceed (y)",
      "  2. Yes, and don't ask again for this command (a)",
      "  3. No, and tell Codex what to do differently (esc)",
      "",
      "  Press enter to confirm or esc to cancel",
    ].join("\n");
    const prompt = extractPrompt(screen);
    expect(prompt.options.map((o) => o.key)).toEqual(["y", "a", "esc"]);
    expect(prompt.options[0]).toMatchObject({ label: "Yes, proceed", selected: true });
    expect(prompt.lines).toEqual(["Would you like to run the following command?", "$ npm test"]);
  });

  it("offers y/n for [y/n] questions", () => {
    const prompt = extractPrompt("Installing deps\nOverwrite existing config? [y/N]\n");
    expect(prompt.options.map((o) => o.key)).toEqual(["y", "n"]);
  });

  it("falls back to the last lines when there is no recognisable choice", () => {
    const prompt = extractPrompt("a\nb\nc\nd\ne\nWhat should I name the branch?\n\n\n");
    expect(prompt).toEqual({ lines: ["d", "e", "What should I name the branch?"], options: [] });
  });

  it("ignores a single numbered line (e.g. a list in the answer)", () => {
    const prompt = extractPrompt("Summary:\n1. Fixed the bug\nAnything else?");
    expect(prompt.options).toEqual([]);
  });

  it("treats non-key parentheticals as part of the label", () => {
    const prompt = extractPrompt("Pick a model\n❯ 1. Opus (recommended)\n  2. Sonnet");
    expect(prompt.options[0]).toEqual({ key: "1", label: "Opus (recommended)", selected: true });
  });

  it("truncates very long labels", () => {
    const long = "x".repeat(80);
    const prompt = extractPrompt(`Pick one\n❯ 1. ${long}\n  2. short`);
    expect(prompt.options[0]!.label.length).toBe(48);
  });
});
