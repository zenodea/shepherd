import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, space, type, themed } from "./theme";

/** Full-screen background that respects the status bar. */
export function Screen({ children, style, edges = ["top"] }: { children: ReactNode; style?: StyleProp<ViewStyle>; edges?: ("top" | "bottom")[] }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        { flex: 1, backgroundColor: colors.background },
        edges.includes("top") && { paddingTop: insets.top },
        edges.includes("bottom") && { paddingBottom: insets.bottom },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Section title with an optional count, e.g. "api 3". */
export function SectionHeader({ title, count, right }: { title: string; count?: number; right?: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={type.section}>{title}</Text>
      {count !== undefined ? <Text style={[type.mono, { color: colors.subtle }]}>{count}</Text> : null}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

/** Thin strip under the header for connection problems. */
export function Banner({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" }) {
  return (
    <View style={[styles.banner, tone === "danger" && { backgroundColor: colors.dangerTint }]}>
      <Text style={[type.sub, tone === "danger" && { color: colors.danger }]}>{children}</Text>
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, marginLeft: inset }} />;
}

const styles = themed(() => StyleSheet.create({
  section: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.sm },
  banner: { backgroundColor: colors.surface, paddingHorizontal: space.lg, paddingVertical: 7 },
}));
