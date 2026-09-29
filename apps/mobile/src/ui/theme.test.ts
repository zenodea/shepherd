import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { select: (o: Record<string, unknown>) => o.default },
  StyleSheet: { create: <T>(s: T) => s },
}));

const { THEMES, applyTheme, colors, statusColors, terminalColor, themed, type } = await import("./theme");
const { BASIC_COLORS } = await import("@shepherd/protocol");

function deepFreeze<T>(o: T): T {
  Object.freeze(o);
  for (const v of Object.values(o as object)) if (v && typeof v === "object" && !Object.isFrozen(v)) deepFreeze(v);
  return o;
}

describe("themes", () => {
  it("switches even after React Native has frozen the rendered text styles", () => {
    // In development React Native freezes style objects it has drawn.
    deepFreeze(type.title);
    deepFreeze(type.sub);
    expect(() => applyTheme("catppuccin", false)).not.toThrow();
    expect(type.title.color).toBe(THEMES.find((t) => t.id === "catppuccin")!.light.text);
    expect(colors.background).toBe("#EFF1F5");
    expect(statusColors.working).toBe("#1E66F5");
  });

  it("rebuilds themed style sheets for the new theme", () => {
    const styles = themed(() => ({ box: { backgroundColor: colors.surface } }));
    applyTheme("gruvbox", true);
    const dark = styles.box.backgroundColor;
    applyTheme("gruvbox", false);
    expect(dark).toBe("#282828");
    expect(styles.box.backgroundColor).toBe("#F9F5D7");
  });

  it("maps the host's terminal colours to the theme's palette", () => {
    applyTheme("tokyonight", true);
    expect(terminalColor(BASIC_COLORS[1]!)).toBe("#F7768E");
    expect(terminalColor("#123456")).toBe("#123456");
    applyTheme("default", true);
    expect(terminalColor(BASIC_COLORS[1]!)).toBe(BASIC_COLORS[1]);
  });

  it("gives every theme a full palette in both variants", () => {
    for (const theme of THEMES) {
      for (const palette of [theme.dark, theme.light]) {
        expect(palette.ansi, theme.id).toHaveLength(16);
        for (const value of [palette.background, palette.text, palette.brand, ...palette.ansi]) expect(value, theme.id).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });
});
