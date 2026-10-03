import { describe, expect, it } from "vitest";
import { activityLine } from "./activity-line";

describe("activityLine", () => {
  it("reads the live status line of Claude Code and Codex", () => {
    const claude = [
      "  ⎿  Running…",
      "· Baking… (5m 20s · ↓ 25.4k tokens · thought for 4s)",
      "  ⎿  Tip: Use /btw to ask a quick side question",
      "────────",
      "❯",
      "────────",
      "  ⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt · ← for agents",
    ].join("\n");
    expect(activityLine(claude)).toBe("Baking… · 5m 20s");
    expect(activityLine("• Ran npm test\n\n• Working (1m 34s • esc to interrupt)\n▌ ")).toBe("Working · 1m 34s");
  });

  it("ignores footers and finds nothing when there's no status line", () => {
    expect(activityLine("  ⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt")).toBeNull();
    expect(activityLine("> \n? for shortcuts")).toBeNull();
  });
});
