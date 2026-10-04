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
        { key: "esc", label: "Tell what to do differently", selected: false, input: true },
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

  it("marks the options where you write the answer yourself", () => {
    const prompt = extractPrompt(
      ["Which database should we use?", "❯ 1. Postgres", "  2. SQLite", "  3. Type something.", "", "Enter to select · Esc to cancel"].join("\n"),
    );
    expect(prompt.options).toEqual([
      { key: "1", label: "Postgres", selected: true },
      { key: "2", label: "SQLite", selected: false },
      { key: "3", label: "Type something.", selected: false, input: true },
    ]);
  });

  it("offers to open a question Codex asked while it keeps working, never Esc", () => {
    const prompt = extractPrompt(
      [
        "• Working (11m 10s • esc to interrupt)",
        "",
        "• Queued follow-up inputs",
        "  ? 1 question",
        "    shift+← to answer",
        "",
        "› Ask Codex to do anything",
        "",
        "  GPT-6-Astra high · ~/.herdr/worktrees/bundle · Review and improve branch",
        "  ← for agents · ? for shortcuts",
      ].join("\n"),
    );
    expect(prompt).toEqual({
      lines: ["A question is waiting."],
      options: [{ key: "shift+left", label: "Show the question", selected: false }],
      noCancel: true,
    });
  });

  it("reads Codex's open question, with Skip instead of Esc", () => {
    const prompt = extractPrompt(
      ["• Queued follow-up inputs", "  Pick a colour", "  › 1. Red", "    2. Blue", "    3. Other", "  enter submit   ctrl+] skip   shift+→ main prompt"].join("\n"),
    );
    expect(prompt.lines.at(-1)).toBe("Pick a colour");
    expect(prompt.options).toEqual([
      { key: "1", label: "Red", selected: true },
      { key: "2", label: "Blue", selected: false },
      { key: "3", label: "Other", selected: false, input: true },
      { key: "ctrl+]", label: "Skip", selected: false },
    ]);
    expect(prompt.noCancel).toBe(true);
  });

  it("answers pi's ask_user_question dialog with arrows from the highlighted row, then Enter", () => {
    const prompt = extractPrompt(
      [
        "  Cache",
        " Which database should the cache use?",
        "❯ 1. Redis",
        "     An in-memory key-value store optimized for fast caching with rich data structures.",
        "  2. Memcached",
        "     A lightweight, high-performance in-memory cache for simple key-value storage.",
        "  3. Postgres",
        "     A durable relational database that can double as a cache with persistence guarantees.",
        "  4. SQLite",
        "     An embedded, file-based database suitable for a local, zero-setup cache.",
        "  5. Type something.",
        "─".repeat(40),
        " Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel · Ctrl+] to collapse",
      ].join("\n"),
    );
    expect(prompt.lines.slice(-2)).toEqual(["Cache", "Which database should the cache use?"]);
    expect(prompt.options.map((o) => o.key)).toEqual(["enter", "down enter", "down down enter", "down down down enter", "down down down down"]);
    expect(prompt.options.at(-1)).toMatchObject({ label: "Type something.", input: true });
  });
});
