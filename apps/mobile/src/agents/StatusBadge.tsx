import { StyleSheet, Text, View } from "react-native";
import type { AgentStatus } from "@sheperd/protocol";
import { statusColors, statusLabels } from "../ui/theme";

export function StatusBadge({ status }: { status: AgentStatus }) {
  const color = statusColors[status];
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{statusLabels[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 12, fontWeight: "600" },
});
