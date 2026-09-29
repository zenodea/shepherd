// Design tokens. Dark only: the app lives next to terminals, and a single
// palette keeps every screen consistent. Colour is reserved for status.
import { Platform } from "react-native";
import type { AgentStatus } from "@sheperd/protocol";

export const colors = {
  background: "#0A0A0A",
  surface: "#141414",
  raised: "#1C1C1C",
  border: "#262626",
  hairline: "rgba(255,255,255,0.08)",
  pressed: "rgba(255,255,255,0.06)",
  text: "#FAFAFA",
  muted: "#A3A3A3",
  subtle: "#6B6B6B",
  /** Primary buttons are white with dark text. */
  primary: "#FAFAFA",
  onPrimary: "#0A0A0A",
  /** Brand amber, from the icon's crook; used sparingly. */
  brand: "#F5B544",
  danger: "#F87171",
  terminal: "#0A0A0A",
} as const;

/** Status colours match the icon's flock: working blue, needs-input orange, done green. */
export const statusColors: Record<AgentStatus, string> = {
  working: "#60A5FA",
  blocked: "#F97316",
  done: "#22C55E",
  idle: "#525252",
  unknown: "#525252",
};

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

export const type = {
  largeTitle: { fontSize: 28, fontWeight: "700" as const, letterSpacing: -0.4, color: colors.text },
  title: { fontSize: 20, fontWeight: "600" as const, letterSpacing: -0.2, color: colors.text },
  section: { fontSize: 17, fontWeight: "600" as const, color: colors.text },
  row: { fontSize: 15, fontWeight: "500" as const, color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  sub: { fontSize: 12.5, color: colors.muted },
  caption: { fontSize: 12, color: colors.subtle },
  mono: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.muted },
} as const;
