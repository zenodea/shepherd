import { Bot, ChevronRight } from "lucide-react-native";
import { createContext, useContext } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Subagent } from "@shepherd/protocol";
import { PressableScale } from "../ui/Pressable";
import { colors, fonts, space, themed } from "../ui/theme";
import { subagentStatusColor, subagentStatusLabel, subagentTime } from "./subagents";

export const SubagentsContext = createContext<{ byId: Map<string, Subagent>; open: (id: string) => void } | null>(null);

export function SubagentRow({ subagent, onPress, indent = 0 }: { subagent: Subagent; onPress: () => void; indent?: number }) {
  const details = [subagent.kind, subagentStatusLabel[subagent.status], subagentTime(subagent), `${subagent.toolCalls} tool call${subagent.toolCalls === 1 ? "" : "s"}`].filter(Boolean);
  return (
    <PressableScale onPress={onPress} style={[styles.card, { marginLeft: indent * 16 }]} accessibilityRole="button" accessibilityLabel={`Subagent ${subagent.name}, ${subagentStatusLabel[subagent.status]}`}>
      <Bot size={17} color={colors.muted} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {subagent.name}
        </Text>
        <Text style={styles.details} numberOfLines={1}>
          <Text style={{ color: subagentStatusColor(subagent.status) }}>● </Text>
          {details.join("  ·  ")}
        </Text>
        {subagent.doing ? (
          <Text style={styles.doing} numberOfLines={1}>
            {subagent.doing}
          </Text>
        ) : null}
      </View>
      <ChevronRight size={16} color={colors.subtle} />
    </PressableScale>
  );
}

/** In the chat, the tool call that started a subagent, as a card that opens it. */
export function SubagentCard({ id }: { id: string }) {
  const ctx = useContext(SubagentsContext);
  const subagent = ctx?.byId.get(id);
  if (!ctx || !subagent) return null;
  return <SubagentRow subagent={subagent} onPress={() => ctx.open(id)} />;
}

const styles = themed(() =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.sm,
      paddingHorizontal: space.md,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    body: { flex: 1, gap: 2 },
    name: { fontSize: 14, fontWeight: "600", color: colors.text },
    details: { fontSize: 12, color: colors.muted },
    doing: { fontFamily: fonts.mono, fontSize: 11, color: colors.subtle },
  }),
);
