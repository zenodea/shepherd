import { useColorScheme } from "react-native";
import type { AgentStatus } from "@sheperd/protocol";

const light = {
  background: "#F6F7F9",
  surface: "#FFFFFF",
  text: "#14171A",
  muted: "#5F6B76",
  border: "#DDE2E7",
  accent: "#2563EB",
  terminal: "#0F1216",
  terminalText: "#D8DEE4",
  danger: "#C2410C",
};

const dark: typeof light = {
  background: "#0F1216",
  surface: "#171B21",
  text: "#E6EAEE",
  muted: "#8B96A1",
  border: "#262C34",
  accent: "#60A5FA",
  terminal: "#0A0C0F",
  terminalText: "#D8DEE4",
  danger: "#FB923C",
};

export type Palette = typeof light;

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export const statusColors: Record<AgentStatus, string> = {
  blocked: "#F97316",
  working: "#3B82F6",
  done: "#22C55E",
  idle: "#94A3B8",
  unknown: "#64748B",
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
