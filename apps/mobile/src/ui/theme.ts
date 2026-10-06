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

export type ThemeId = "default" | "catppuccin" | "tokyonight" | "gruvbox" | "everforest" | "rosepine" | "zenbones" | "nightowl" | "dracula" | "nord" | "kanagawa" | "github";
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
  {
    id: "rosepine",
    name: "Rosé Pine",
    // Main
    dark: {
      background: "#191724",
      surface: "#1F1D2E",
      raised: "#26233A",
      border: "#403D52",
      text: "#E0DEF4",
      muted: "#908CAA",
      subtle: "#6E6A86",
      primary: "#C4A7E7",
      onPrimary: "#191724",
      brand: "#F6C177",
      danger: "#EB6F92",
      terminal: "#191724",
      terminalText: "#E0DEF4",
      status: { working: "#C4A7E7", blocked: "#F6C177", done: "#9CCFD8", idle: "#6E6A86", unknown: "#6E6A86" },
      ansi: ["#26233A", "#EB6F92", "#31748F", "#F6C177", "#9CCFD8", "#C4A7E7", "#EBBCBA", "#E0DEF4", "#6E6A86", "#EB6F92", "#31748F", "#F6C177", "#9CCFD8", "#C4A7E7", "#EBBCBA", "#E0DEF4"],
    },
    // Dawn
    light: {
      background: "#FAF4ED",
      surface: "#FFFAF3",
      raised: "#F2E9E1",
      border: "#DFDAD9",
      text: "#575279",
      muted: "#797593",
      subtle: "#9893A5",
      primary: "#907AA9",
      onPrimary: "#FAF4ED",
      brand: "#EA9D34",
      danger: "#B4637A",
      terminal: "#FAF4ED",
      terminalText: "#575279",
      status: { working: "#907AA9", blocked: "#EA9D34", done: "#56949F", idle: "#9893A5", unknown: "#9893A5" },
      ansi: ["#575279", "#B4637A", "#286983", "#EA9D34", "#56949F", "#907AA9", "#D7827E", "#DFDAD9", "#797593", "#B4637A", "#286983", "#EA9D34", "#56949F", "#907AA9", "#D7827E", "#F2E9E1"],
    },
  },
  {
    id: "zenbones",
    name: "Zenbones",
    dark: {
      background: "#1C1917",
      surface: "#252120",
      raised: "#2E2A27",
      border: "#403833",
      text: "#B4BDC3",
      muted: "#8E9599",
      subtle: "#6E6763",
      primary: "#B4BDC3",
      onPrimary: "#1C1917",
      brand: "#B77E64",
      danger: "#DE6E7C",
      terminal: "#1C1917",
      terminalText: "#B4BDC3",
      status: { working: "#6099C0", blocked: "#B77E64", done: "#819B69", idle: "#6E6763", unknown: "#6E6763" },
      ansi: ["#3D3834", "#DE6E7C", "#819B69", "#B77E64", "#6099C0", "#B279A7", "#66A5AD", "#B4BDC3", "#4F4741", "#E8838F", "#8BAE68", "#D68C67", "#61ABDA", "#CF86C1", "#65B8C1", "#888F94"],
    },
    light: {
      background: "#F0EDEC",
      surface: "#E9E4E2",
      raised: "#E1DAD7",
      border: "#CFC1BA",
      text: "#2C363C",
      muted: "#4F5E68",
      subtle: "#88827D",
      primary: "#2C363C",
      onPrimary: "#F0EDEC",
      brand: "#944927",
      danger: "#A8334C",
      terminal: "#F0EDEC",
      terminalText: "#2C363C",
      status: { working: "#286486", blocked: "#944927", done: "#4F6C31", idle: "#88827D", unknown: "#88827D" },
      ansi: ["#2C363C", "#A8334C", "#4F6C31", "#944927", "#286486", "#88507D", "#3B8992", "#CFC1BA", "#4F5E68", "#94253E", "#3F5A22", "#803D1C", "#1D5573", "#7B3B70", "#2B747C", "#E1DAD7"],
    },
  },
  {
    id: "nightowl",
    name: "Night Owl",
    // Night Owl
    dark: {
      background: "#011627",
      surface: "#0B2942",
      raised: "#13344F",
      border: "#1D3B53",
      text: "#D6DEEB",
      muted: "#8BADC1",
      subtle: "#5F7E97",
      primary: "#82AAFF",
      onPrimary: "#011627",
      brand: "#F78C6C",
      danger: "#EF5350",
      terminal: "#011627",
      terminalText: "#D6DEEB",
      status: { working: "#82AAFF", blocked: "#F78C6C", done: "#ADDB67", idle: "#5F7E97", unknown: "#5F7E97" },
      ansi: ["#1D3B53", "#EF5350", "#22DA6E", "#ADDB67", "#82AAFF", "#C792EA", "#21C7A8", "#D6DEEB", "#575656", "#EF5350", "#22DA6E", "#FFEB95", "#82AAFF", "#C792EA", "#7FDBCA", "#FFFFFF"],
    },
    // Light Owl
    light: {
      background: "#FBFBFB",
      surface: "#F0F0F0",
      raised: "#E6E6E6",
      border: "#D9D9D9",
      text: "#403F53",
      muted: "#696A80",
      subtle: "#989FB1",
      primary: "#4876D6",
      onPrimary: "#FBFBFB",
      brand: "#C96765",
      danger: "#DE3D3B",
      terminal: "#FBFBFB",
      terminalText: "#403F53",
      status: { working: "#4876D6", blocked: "#C96765", done: "#08916A", idle: "#989FB1", unknown: "#989FB1" },
      ansi: ["#403F53", "#DE3D3B", "#08916A", "#B58C00", "#288ED7", "#D6438A", "#2AA298", "#D9D9D9", "#989FB1", "#DE3D3B", "#08916A", "#B58C00", "#288ED7", "#D6438A", "#2AA298", "#F0F0F0"],
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    // Dracula
    dark: {
      background: "#21222C",
      surface: "#282A36",
      raised: "#343746",
      border: "#44475A",
      text: "#F8F8F2",
      muted: "#BFBFCF",
      subtle: "#6272A4",
      primary: "#BD93F9",
      onPrimary: "#21222C",
      brand: "#FFB86C",
      danger: "#FF5555",
      terminal: "#282A36",
      terminalText: "#F8F8F2",
      status: { working: "#8BE9FD", blocked: "#FFB86C", done: "#50FA7B", idle: "#6272A4", unknown: "#6272A4" },
      ansi: ["#21222C", "#FF5555", "#50FA7B", "#F1FA8C", "#BD93F9", "#FF79C6", "#8BE9FD", "#F8F8F2", "#6272A4", "#FF6E6E", "#69FF94", "#FFFFA5", "#D6ACFF", "#FF92DF", "#A4FFFF", "#FFFFFF"],
    },
    // Alucard
    light: {
      background: "#FFFBEB",
      surface: "#F6F2DF",
      raised: "#ECE8D3",
      border: "#CFCFDE",
      text: "#1F1F1F",
      muted: "#5C5843",
      subtle: "#8E8A73",
      primary: "#644AC9",
      onPrimary: "#FFFBEB",
      brand: "#A34D14",
      danger: "#CB3A2A",
      terminal: "#FFFBEB",
      terminalText: "#1F1F1F",
      status: { working: "#036A96", blocked: "#A34D14", done: "#14710A", idle: "#8E8A73", unknown: "#8E8A73" },
      ansi: ["#1F1F1F", "#CB3A2A", "#14710A", "#846E15", "#644AC9", "#A3144D", "#036A96", "#CFCFDE", "#6C664B", "#D74C3D", "#198D0C", "#9E841A", "#7862D0", "#BF1858", "#047FB4", "#ECE8D3"],
    },
  },
  {
    id: "nord",
    name: "Nord",
    dark: {
      background: "#242933",
      surface: "#2E3440",
      raised: "#3B4252",
      border: "#434C5E",
      text: "#ECEFF4",
      muted: "#B0B8C6",
      subtle: "#7B88A1",
      primary: "#88C0D0",
      onPrimary: "#2E3440",
      brand: "#D08770",
      danger: "#BF616A",
      terminal: "#2E3440",
      terminalText: "#D8DEE9",
      status: { working: "#81A1C1", blocked: "#D08770", done: "#A3BE8C", idle: "#7B88A1", unknown: "#7B88A1" },
      ansi: ["#3B4252", "#BF616A", "#A3BE8C", "#EBCB8B", "#81A1C1", "#B48EAD", "#88C0D0", "#E5E9F0", "#4C566A", "#BF616A", "#A3BE8C", "#EBCB8B", "#81A1C1", "#B48EAD", "#8FBCBB", "#ECEFF4"],
    },
    light: {
      background: "#ECEFF4",
      surface: "#E5E9F0",
      raised: "#D8DEE9",
      border: "#C5CDD9",
      text: "#2E3440",
      muted: "#4C566A",
      subtle: "#7B88A1",
      primary: "#5E81AC",
      onPrimary: "#ECEFF4",
      brand: "#C4704F",
      danger: "#BF616A",
      terminal: "#ECEFF4",
      terminalText: "#2E3440",
      status: { working: "#5E81AC", blocked: "#C4704F", done: "#6F8E5A", idle: "#7B88A1", unknown: "#7B88A1" },
      ansi: ["#3B4252", "#BF616A", "#6F8E5A", "#B0802B", "#5E81AC", "#9A6F96", "#4C8B99", "#C5CDD9", "#4C566A", "#BF616A", "#6F8E5A", "#B0802B", "#5E81AC", "#9A6F96", "#4C8B99", "#D8DEE9"],
    },
  },
  {
    id: "kanagawa",
    name: "Kanagawa",
    // Wave
    dark: {
      background: "#16161D",
      surface: "#1F1F28",
      raised: "#2A2A37",
      border: "#363646",
      text: "#DCD7BA",
      muted: "#C8C093",
      subtle: "#727169",
      primary: "#7E9CD8",
      onPrimary: "#1F1F28",
      brand: "#FFA066",
      danger: "#E82424",
      terminal: "#1F1F28",
      terminalText: "#DCD7BA",
      status: { working: "#7E9CD8", blocked: "#FFA066", done: "#98BB6C", idle: "#727169", unknown: "#727169" },
      ansi: ["#363646", "#C34043", "#76946A", "#C0A36E", "#7E9CD8", "#957FB8", "#6A9589", "#C8C093", "#727169", "#E82424", "#98BB6C", "#E6C384", "#7FB4CA", "#938AA9", "#7AA89F", "#DCD7BA"],
    },
    // Lotus
    light: {
      background: "#F2ECBC",
      surface: "#E5DDB0",
      raised: "#DCD5AC",
      border: "#CFC49C",
      text: "#545464",
      muted: "#6D6C68",
      subtle: "#8A8980",
      primary: "#4D699B",
      onPrimary: "#F2ECBC",
      brand: "#CC6D00",
      danger: "#C84053",
      terminal: "#F2ECBC",
      terminalText: "#545464",
      status: { working: "#4D699B", blocked: "#CC6D00", done: "#6F894E", idle: "#8A8980", unknown: "#8A8980" },
      ansi: ["#545464", "#C84053", "#6F894E", "#77713F", "#4D699B", "#B35B79", "#597B75", "#CFC49C", "#8A8980", "#D7474B", "#6E915F", "#836F4A", "#6693BF", "#624C83", "#5E857A", "#DCD5AC"],
    },
  },
  {
    id: "github",
    name: "GitHub",
    dark: {
      background: "#0D1117",
      surface: "#161B22",
      raised: "#21262D",
      border: "#30363D",
      text: "#E6EDF3",
      muted: "#9198A1",
      subtle: "#6E7681",
      primary: "#E6EDF3",
      onPrimary: "#0D1117",
      brand: "#DB6D28",
      danger: "#F85149",
      terminal: "#0D1117",
      terminalText: "#E6EDF3",
      status: { working: "#58A6FF", blocked: "#DB6D28", done: "#3FB950", idle: "#6E7681", unknown: "#6E7681" },
      ansi: ["#484F58", "#FF7B72", "#3FB950", "#D29922", "#58A6FF", "#BC8CFF", "#39C5CF", "#B1BAC4", "#6E7681", "#FFA198", "#56D364", "#E3B341", "#79C0FF", "#D2A8FF", "#56D4DD", "#FFFFFF"],
    },
    light: {
      background: "#FFFFFF",
      surface: "#F6F8FA",
      raised: "#EAEEF2",
      border: "#D0D7DE",
      text: "#1F2328",
      muted: "#59636E",
      subtle: "#818B98",
      primary: "#1F2328",
      onPrimary: "#FFFFFF",
      brand: "#BC4C00",
      danger: "#CF222E",
      terminal: "#FFFFFF",
      terminalText: "#1F2328",
      status: { working: "#0969DA", blocked: "#BC4C00", done: "#1A7F37", idle: "#818B98", unknown: "#818B98" },
      ansi: ["#24292F", "#CF222E", "#116329", "#4D2D00", "#0969DA", "#8250DF", "#1B7C83", "#6E7781", "#57606A", "#A40E26", "#1A7F37", "#633C01", "#218BFF", "#A475F9", "#3192AA", "#8C959F"],
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
    /** Code in diffs, from the theme's terminal colours: keywords magenta, strings green, numbers yellow. */
    syntaxKeyword: p.ansi[5] ?? p.text,
    syntaxString: p.ansi[2] ?? p.text,
    syntaxNumber: p.ansi[3] ?? p.text,
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
