import { StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";

/** A recognisable glyph and colour per agent CLI; anything else gets its initial. */
const MARKS: Record<string, { glyph: string; color: string }> = {
  claude: { glyph: "✻", color: "#D97757" },
  codex: { glyph: "◎", color: "#E5E5E5" },
  gemini: { glyph: "✦", color: "#8AB4F8" },
  opencode: { glyph: "▣", color: "#E5E5E5" },
  cursor: { glyph: "◆", color: "#E5E5E5" },
  copilot: { glyph: "◉", color: "#A78BFA" },
  amp: { glyph: "⚡", color: "#F5B544" },
  pi: { glyph: "π", color: "#E5E5E5" },
};

export function AgentMark({ agent, size = 28 }: { agent: string | null | undefined; size?: number }) {
  const key = (agent ?? "").toLowerCase();
  const mark = MARKS[key] ?? { glyph: (key[0] ?? "?").toUpperCase(), color: colors.muted };
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: mark.color, fontSize: size * 0.52, fontWeight: "700", lineHeight: size * 0.66 }}>{mark.glyph}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
});
