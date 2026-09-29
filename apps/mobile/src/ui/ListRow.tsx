import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { PressableScale } from "./Pressable";
import { colors, space, type } from "./theme";

/** Settings-style row: icon column, title + optional detail, trailing accessory. */
export function ListRow({
  icon,
  title,
  detail,
  trailing,
  onPress,
  destructive = false,
  chevron = !!onPress,
}: {
  icon?: ReactNode;
  title: string;
  detail?: string | null;
  trailing?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  chevron?: boolean;
}) {
  const body = (
    <View style={styles.row}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.row, destructive && { color: colors.danger }]}>{title}</Text>
        {detail ? (
          <Text style={type.sub} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing}
      {chevron ? <ChevronRight size={18} color={colors.subtle} /> : null}
    </View>
  );
  return onPress ? <PressableScale onPress={onPress}>{body}</PressableScale> : body;
}

/** A rounded group of rows. */
export function ListGroup({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 14, minHeight: 56 },
  icon: { width: 28, alignItems: "center" },
  group: { backgroundColor: colors.surface, borderRadius: 14, overflow: "hidden", marginHorizontal: space.lg },
});
