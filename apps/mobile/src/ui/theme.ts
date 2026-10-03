// Design tokens and colour themes. Every theme has a dark and a light
// variant; colour is reserved for status, the accent, and the terminal.
//
// `colors`, `statusColors` and `type` are live objects: `applyTheme` updates
// their values (`type` gets fresh entries), and style sheets wrapped in
// `themed()` rebuild on next use.
// Screens remount when the theme changes (see ThemeProvider), so everything
// reads the new values.
import { Platform, StyleSheet } from "react-native";
import { BASIC_COLORS, BRIGHT_COLORS, type AgentStatus } from "@shepherd/protocol";

type StatusPalette = Record<AgentStatus, string>;

export type Palette = {
  background: string;
  surface: string;
  raised: string;
  border: string;
  text: string;
  muted: string;
  subtle: string;
  /** Primary buttons. */
  primary: string;
  onPrimary: string;
  /** Accent: switches, badges, search matches. */
  brand: string;
  danger: string;
  terminal: string;
  terminalText: string;
  status: StatusPalette;
  /** The 16 terminal colours: black, red, green, yellow, blue, magenta, cyan, white, then the bright ones. */
  ansi: string[];
};

export type ThemeId = "default" | "catppuccin" | "tokyonight" | "gruvbox" | "everforest";
export type ThemeMode = "system" | "dark" | "light";

export const THEMES: { id: ThemeId; name: string; dark: Palette; light: Palette }[] = [
  {
    id: "default",
    name: "Default",
    dark: {
      background: "#0A0A0A",
      surface: "#141414",
      raised: "#1C1C1C",
      border: "#262626",
      text: "#FAFAFA",
      muted: "#A3A3A3",
      subtle: "#6B6B6B",
      primary: "#FAFAFA",
      onPrimary: "#0A0A0A",
      brand: "#F5B544",
      danger: "#F87171",
      terminal: "#0A0A0A",
      terminalText: "#E5E5E5",
      status: { working: "#60A5FA", blocked: "#F97316", done: "#22C55E", idle: "#525252", unknown: "#525252" },
      ansi: [...BASIC_COLORS, ...BRIGHT_COLORS],
    },
    light: {
      background: "#F6F6F7",
      surface: "#FFFFFF",
      raised: "#EDEDEF",
      border: "#DEDEE2",
      text: "#111113",
      muted: "#5F5F66",
      subtle: "#8E8E96",
      primary: "#111113",
      onPrimary: "#FFFFFF",
      brand: "#C27A00",
      danger: "#DC2626",
      terminal: "#FFFFFF",
      terminalText: "#1F2328",
      status: { working: "#2563EB", blocked: "#EA580C", done: "#16A34A", idle: "#A1A1AA", unknown: "#A1A1AA" },
      ansi: ["#24292F", "#CF222E", "#116329", "#4D2D00", "#0969DA", "#8250DF", "#1B7C83", "#6E7781", "#57606A", "#A40E26", "#1A7F37", "#633C01", "#218BFF", "#A475F9", "#3192AA", "#8C959F"],
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    // Mocha
    dark: {
      background: "#11111B",
      surface: "#1E1E2E",
      raised: "#313244",
      border: "#45475A",
      text: "#CDD6F4",
      muted: "#A6ADC8",
      subtle: "#6C7086",
      primary: "#B4BEFE",
      onPrimary: "#11111B",
      brand: "#FAB387",
      danger: "#F38BA8",
      terminal: "#11111B",
      terminalText: "#CDD6F4",
      status: { working: "#89B4FA", blocked: "#FAB387", done: "#A6E3A1", idle: "#6C7086", unknown: "#6C7086" },
      ansi: ["#45475A", "#F38BA8", "#A6E3A1", "#F9E2AF", "#89B4FA", "#F5C2E7", "#94E2D5", "#BAC2DE", "#585B70", "#F38BA8", "#A6E3A1", "#F9E2AF", "#89B4FA", "#F5C2E7", "#94E2D5", "#A6ADC8"],
    },
    // Latte
    light: {
      background: "#EFF1F5",
      surface: "#E6E9EF",
      raised: "#DCE0E8",
      border: "#CCD0DA",
      text: "#4C4F69",
      muted: "#6C6F85",
      subtle: "#9CA0B0",
      primary: "#8839EF",
      onPrimary: "#EFF1F5",
      brand: "#FE640B",
      danger: "#D20F39",
      terminal: "#EFF1F5",
      terminalText: "#4C4F69",
      status: { working: "#1E66F5", blocked: "#FE640B", done: "#40A02B", idle: "#9CA0B0", unknown: "#9CA0B0" },
      ansi: ["#5C5F77", "#D20F39", "#40A02B", "#DF8E1D", "#1E66F5", "#EA76CB", "#179299", "#ACB0BE", "#6C6F85", "#D20F39", "#40A02B", "#DF8E1D", "#1E66F5", "#EA76CB", "#179299", "#BCC0CC"],
    },
  },
  {
    id: "tokyonight",
    name: "Tokyo Night",
    dark: {
      background: "#16161E",
      surface: "#1A1B26",
      raised: "#292E42",
      border: "#3B4261",
      text: "#C0CAF5",
      muted: "#A9B1D6",
      subtle: "#565F89",
      primary: "#7AA2F7",
      onPrimary: "#16161E",
      brand: "#FF9E64",
      danger: "#F7768E",
      terminal: "#16161E",
      terminalText: "#C0CAF5",
      status: { working: "#7AA2F7", blocked: "#FF9E64", done: "#9ECE6A", idle: "#565F89", unknown: "#565F89" },
      ansi: ["#15161E", "#F7768E", "#9ECE6A", "#E0AF68", "#7AA2F7", "#BB9AF7", "#7DCFFF", "#A9B1D6", "#414868", "#F7768E", "#9ECE6A", "#E0AF68", "#7AA2F7", "#BB9AF7", "#7DCFFF", "#C0CAF5"],
    },
    // Day
    light: {
      background: "#E1E2E7",
      surface: "#E9E9ED",
      raised: "#D5D6DB",
      border: "#C4C8DA",
      text: "#3760BF",
      muted: "#6172B0",
      subtle: "#848CB5",
      primary: "#2E7DE9",
      onPrimary: "#E1E2E7",
      brand: "#B15C00",
      danger: "#F52A65",
      terminal: "#E1E2E7",
      terminalText: "#3760BF",
      status: { working: "#2E7DE9", blocked: "#B15C00", done: "#587539", idle: "#848CB5", unknown: "#848CB5" },
      ansi: ["#E9E9ED", "#F52A65", "#587539", "#8C6C3E", "#2E7DE9", "#9854F1", "#007197", "#6172B0", "#A1A6C5", "#F52A65", "#587539", "#8C6C3E", "#2E7DE9", "#9854F1", "#007197", "#3760BF"],
    },
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    dark: {
      background: "#1D2021",
      surface: "#282828",
      raised: "#3C3836",
      border: "#504945",
      text: "#EBDBB2",
      muted: "#A89984",
      subtle: "#7C6F64",
      primary: "#EBDBB2",
      onPrimary: "#1D2021",
      brand: "#FE8019",
      danger: "#FB4934",
      terminal: "#1D2021",
      terminalText: "#EBDBB2",
      status: { working: "#83A598", blocked: "#FE8019", done: "#B8BB26", idle: "#7C6F64", unknown: "#7C6F64" },
      ansi: ["#282828", "#CC241D", "#98971A", "#D79921", "#458588", "#B16286", "#689D6A", "#A89984", "#928374", "#FB4934", "#B8BB26", "#FABD2F", "#83A598", "#D3869B", "#8EC07C", "#EBDBB2"],
    },
    light: {
      background: "#FBF1C7",
      surface: "#F9F5D7",
      raised: "#EBDBB2",
      border: "#D5C4A1",
      text: "#3C3836",
      muted: "#665C54",
      subtle: "#928374",
      primary: "#3C3836",
      onPrimary: "#FBF1C7",
      brand: "#AF3A03",
      danger: "#9D0006",
      terminal: "#FBF1C7",
      terminalText: "#3C3836",
      status: { working: "#076678", blocked: "#AF3A03", done: "#79740E", idle: "#928374", unknown: "#928374" },
      ansi: ["#FBF1C7", "#CC241D", "#98971A", "#D79921", "#458588", "#B16286", "#689D6A", "#7C6F64", "#928374", "#9D0006", "#79740E", "#B57614", "#076678", "#8F3F71", "#427B58", "#3C3836"],
    },
  },
  {
    id: "everforest",
    name: "Everforest",
    dark: {
      background: "#232A2E",
      surface: "#2D353B",
      raised: "#343F44",
      border: "#475258",
      text: "#D3C6AA",
      muted: "#9DA9A0",
      subtle: "#7A8478",
      primary: "#A7C080",
      onPrimary: "#232A2E",
      brand: "#E69875",
      danger: "#E67E80",
      terminal: "#232A2E",
      terminalText: "#D3C6AA",
      status: { working: "#7FBBB3", blocked: "#E69875", done: "#A7C080", idle: "#7A8478", unknown: "#7A8478" },
      ansi: ["#475258", "#E67E80", "#A7C080", "#DBBC7F", "#7FBBB3", "#D699B6", "#83C092", "#D3C6AA", "#859289", "#E67E80", "#A7C080", "#DBBC7F", "#7FBBB3", "#D699B6", "#83C092", "#D3C6AA"],
    },
    light: {
      background: "#FDF6E3",
      surface: "#F4F0D9",
      raised: "#E6E2CC",
      border: "#E0DCC7",
      text: "#5C6A72",
      muted: "#829181",
      subtle: "#A6B0A0",
      primary: "#8DA101",
      onPrimary: "#FDF6E3",
      brand: "#F57D26",
      danger: "#F85552",
      terminal: "#FDF6E3",
      terminalText: "#5C6A72",
      status: { working: "#3A94C5", blocked: "#F57D26", done: "#8DA101", idle: "#A6B0A0", unknown: "#A6B0A0" },
      ansi: ["#5C6A72", "#F85552", "#8DA101", "#DFA000", "#3A94C5", "#DF69BA", "#35A77C", "#E0DCC7", "#829181", "#F85552", "#8DA101", "#DFA000", "#3A94C5", "#DF69BA", "#35A77C", "#BEC5B2"],
    },
  },
];

/** `#RRGGBB` at an opacity, as rgba(). */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function derive(p: Palette, dark: boolean) {
  return {
    background: p.background,
    surface: p.surface,
    raised: p.raised,
    border: p.border,
    hairline: alpha(p.text, 0.08),
    pressed: alpha(p.text, 0.06),
    /** Hairline edges on floating elements. */
    edge: alpha(p.text, 0.14),
    /** Floating pills and buttons over the terminal. */
    floating: alpha(p.raised, 0.96),
    text: p.text,
    muted: p.muted,
    subtle: p.subtle,
    primary: p.primary,
    onPrimary: p.onPrimary,
    brand: p.brand,
    danger: p.danger,
    dangerTint: alpha(p.danger, 0.12),
    terminal: p.terminal,
    terminalText: p.terminalText,
    link: alpha(p.terminalText, 0.45),
    /** Links in the chat: the theme's bright blue. */
    linkText: p.ansi[12] ?? p.brand,
    match: alpha(p.brand, dark ? 0.35 : 0.28),
    backdrop: dark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.3)",
    dark,
  };
}

export type Colors = ReturnType<typeof derive>;

const initial = THEMES[0]!.dark;

// Live objects: their identity never changes, only their values.
export const colors: Colors = derive(initial, true);
export const statusColors: StatusPalette = { ...initial.status };

/** Status colours match the icon's flock: working blue, needs-input orange, done green. */
export const statusLabels: Record<AgentStatus, string> = {
  blocked: "Needs input",
  working: "Working",
  done: "Done",
  idle: "Idle",
  unknown: "Unknown",
};

/** Sort order: agents that need you first. */
export const statusRank: Record<AgentStatus, number> = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };

export const radii = { sm: 8, md: 10, lg: 14, xl: 20, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** JetBrains Mono is bundled (assets/fonts) and loaded in the root layout. */
export const fonts = {
  mono: Platform.select({ web: "JetBrainsMono, ui-monospace, Menlo, monospace", default: "JetBrainsMono" }),
  monoBold: Platform.select({ web: "JetBrainsMono-Bold, ui-monospace, Menlo, monospace", default: "JetBrainsMono-Bold" }),
} as const;

function typeScale(c: Colors) {
  return {
    largeTitle: { fontSize: 28, fontWeight: "700" as const, letterSpacing: -0.4, color: c.text },
    title: { fontSize: 20, fontWeight: "600" as const, letterSpacing: -0.2, color: c.text },
    section: { fontSize: 17, fontWeight: "600" as const, color: c.text },
    row: { fontSize: 15, fontWeight: "500" as const, color: c.text },
    body: { fontSize: 15, color: c.text, lineHeight: 21 },
    sub: { fontSize: 12.5, color: c.muted },
    caption: { fontSize: 12, color: c.subtle },
    mono: { fontFamily: fonts.mono, fontSize: 12.5, color: c.muted },
  };
}

export const type = typeScale(colors);

// The host sends terminal colours as the default palette's hex values; the
// theme swaps those 16 for its own.
const DEFAULT_ANSI = [...BASIC_COLORS, ...BRIGHT_COLORS];
let ansiMap = new Map<string, string>();

/** A terminal colour from the host, in the current theme. */
export function terminalColor(hex: string): string {
  return ansiMap.get(hex) ?? hex;
}

let version = 0;
export function themeVersion(): number {
  return version;
}

/** Switch every live token to a theme's dark or light palette. */
export function applyTheme(id: ThemeId, dark: boolean): void {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0]!;
  const palette = dark ? theme.dark : theme.light;
  Object.assign(colors, derive(palette, dark));
  Object.assign(statusColors, palette.status);
  // Swap in new text styles rather than editing the old ones: React Native
  // freezes style objects it has rendered (in development), so they can't change.
  Object.assign(type, typeScale(colors));
  ansiMap = new Map(DEFAULT_ANSI.map((hex, i) => [hex, palette.ansi[i] ?? hex]));
  version++;
}

/**
 * A style sheet that is rebuilt from the live tokens after a theme change.
 * Use it like `StyleSheet.create`: `const styles = themed(() => StyleSheet.create({…}))`.
 */
export function themed<T extends StyleSheet.NamedStyles<T>>(build: () => T): T {
  let built: T | null = null;
  let builtFor = -1;
  const current = () => {
    if (!built || builtFor !== version) {
      built = build();
      builtFor = version;
    }
    return built;
  };
  return new Proxy({} as T, {
    get: (_, key) => current()[key as keyof T],
    has: (_, key) => key in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_, key) => Object.getOwnPropertyDescriptor(current(), key),
  });
}
