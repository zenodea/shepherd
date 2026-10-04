import { describe, expect, it } from "vitest";
import { sameModel } from "./models.ts";
import { menuRows } from "./screen.ts";
import { effortSlider, footerEffort } from "./vendors/claude.ts";
import { footer } from "./vendors/codex.ts";
import { footer as piFooter, parseModelList } from "./vendors/pi.ts";

const CLAUDE_MODELS = `❯ /model

──────────────────────────────────────────
  Select model
  Switch between Claude models. Your pick becomes the default for new sessions.

  ❯ 1.  Default (recommended) ✔  Opus 5.5 · Best for everyday, complex tasks
    2.  Opus 5.5                 For complex work and everyday tasks
    3.  Fable 5.1                For your toughest challenges
  ↓ 4.  Haiku 4.5                Fastest for quick answers
     … +2 models

  ● High effort ←/→ to adjust`;

const CLAUDE_EFFORT = `  Effort
                        Faster                             Smarter
                        ────────────────────▲─────────────────────      Ultracode  off
                        low     medium     high     xhigh      max      Tab to toggle
  ←/→ to adjust · Enter to confirm · s for this session only · Esc to cancel`;

const CODEX_MODELS = `  Select Model and Effort
  1. GPT-6.1-Sol (default)  Latest workhorse model for coding and everyday work.
› 2. GPT-6-Astra (current)  Frontier intelligence for the most demanding work.
  3. GPT-6-Luna             Fast and affordable model for easier tasks.
  enter select · esc back`;

describe("menuRows", () => {
  it("reads Claude Code's model menu", () => {
    expect(menuRows(CLAUDE_MODELS, /Select model/)).toEqual([
      { number: 1, label: "Default", detail: "Opus 5.5 · Best for everyday, complex tasks", cursor: true, current: true, isDefault: false },
      { number: 2, label: "Opus 5.5", detail: "For complex work and everyday tasks", cursor: false, current: false, isDefault: false },
      { number: 3, label: "Fable 5.1", detail: "For your toughest challenges", cursor: false, current: false, isDefault: false },
      { number: 4, label: "Haiku 4.5", detail: "Fastest for quick answers", cursor: false, current: false, isDefault: false },
    ]);
  });

  it("reads Codex's model menu, and nothing above the title", () => {
    const rows = menuRows(`1. not this\n${CODEX_MODELS}`, /Select Model and Effort/);
    expect(rows.map((r) => [r.number, r.label, r.cursor, r.current, r.isDefault])).toEqual([
      [1, "GPT-6.1-Sol", false, false, true],
      [2, "GPT-6-Astra", true, true, false],
      [3, "GPT-6-Luna", false, false, false],
    ]);
  });
});

describe("Claude Code", () => {
  it("reads the effort slider", () => {
    expect(effortSlider(CLAUDE_EFFORT)).toEqual({ levels: ["low", "medium", "high", "xhigh", "max"], at: 2 });
    expect(effortSlider(CLAUDE_EFFORT.replace("────────────────────▲", "──▲──────────────────"))?.at).toBe(0);
  });

  it("reads the effort in the footer", () => {
    expect(footerEffort("  ⏵⏵ auto mode on (shift+tab to cycle)            ● high · /effort")).toBe("high");
  });

  it("matches model ids to labels", () => {
    expect(sameModel("Opus 5.5", "claude-opus-5-5")).toBe(true);
    expect(sameModel("Haiku 4.5", "claude-haiku-4-5-20251001")).toBe(true);
    expect(sameModel("Opus 5", "claude-opus-5-5")).toBe(false);
  });
});

describe("Codex", () => {
  it("reads the model and effort in the footer", () => {
    const models = [{ label: "GPT-6-Astra" }, { label: "GPT-6" }];
    const efforts = [{ label: "Low" }, { label: "High" }, { label: "Extra high" }];
    expect(footer("› Ask Codex to do anything\n\n  GPT-6-Astra high · ~/Work/app", models, efforts)).toEqual({ model: "GPT-6-Astra", effort: "High" });
    expect(footer("  GPT-6-Astra xhigh · ~/Work/app", models, efforts)).toEqual({ model: "GPT-6-Astra", effort: "Extra high" });
    expect(footer("nothing here", models, efforts)).toEqual({ model: null, effort: null });
  });
});

describe("Pi", () => {
  const LIST = `provider   model                       context  max-out  thinking  images
anthropic  claude-sonnet-5             1M       128K     yes       yes
anthropic  claude-sonnet-5-5           1M       128K     yes       yes
openai     gpt-4                       8.2K     8.2K     no        no
`;
  const models = parseModelList(LIST);

  it("reads pi --list-models", () => {
    expect(models).toEqual([
      { id: "anthropic/claude-sonnet-5", label: "claude-sonnet-5", group: "anthropic", detail: "1M context · images" },
      { id: "anthropic/claude-sonnet-5-5", label: "claude-sonnet-5-5", group: "anthropic", detail: "1M context · images" },
      { id: "openai/gpt-4", label: "gpt-4", group: "openai", detail: "8.2K context", noEffort: true },
    ]);
    expect(parseModelList("Warning: something\n")).toEqual([]);
  });

  it("reads Pi's own footer", () => {
    expect(piFooter("↑12k ↓3k $0.12        (anthropic) claude-sonnet-5 • high", models, null)).toEqual({ model: "anthropic/claude-sonnet-5", effort: "high" });
    expect(piFooter("↑12k        gpt-4 • thinking off", models, null)).toEqual({ model: "openai/gpt-4", effort: "off" });
  });

  it("reads the powerline footer", () => {
    expect(piFooter("  Sonnet 5.5  think:low   sheperd   main   0/1.0M (0.0%)", models, null)).toEqual({ model: "anthropic/claude-sonnet-5-5", effort: "low" });
    expect(piFooter("  Sonnet 5  think:xhigh   sheperd", models, null)).toEqual({ model: "anthropic/claude-sonnet-5", effort: "xhigh" });
    expect(piFooter("  \u{f06a9} Sonnet 5 \u{e0b1} think:xhigh  \ue5ff sheperd", models, null)).toEqual({ model: "anthropic/claude-sonnet-5", effort: "xhigh" });
  });
});
