import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { PressableScale } from "./Pressable";
import { colors, radii, themed } from "./theme";

type Variant = "primary" | "secondary" | "ghost" | "danger";

// A function, so the colours follow the current theme.
const variantStyles = (): Record<Variant, { bg: string; fg: string; border?: string }> => ({
  primary: { bg: colors.primary, fg: colors.onPrimary },
  secondary: { bg: colors.raised, fg: colors.text, border: colors.border },
  ghost: { bg: "transparent", fg: colors.text },
  danger: { bg: "transparent", fg: colors.danger },
});

export function Button({
  title,
  onPress,
  variant = "primary",
  icon,
  loading = false,
  disabled = false,
  size = "lg",
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  size?: "md" | "lg";
  style?: StyleProp<ViewStyle>;
}) {
  const v = variantStyles()[variant];
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.base,
        size === "lg" ? styles.lg : styles.md,
        { backgroundColor: v.bg, borderColor: v.border ?? "transparent", borderWidth: v.border ? StyleSheet.hairlineWidth * 2 : 0 },
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator size="small" color={v.fg} /> : icon}
        <Text style={[styles.label, { color: v.fg }, size === "md" && { fontSize: 14 }]}>{title}</Text>
      </View>
    </PressableScale>
  );
}

const styles = themed(() => StyleSheet.create({
  base: { borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  lg: { height: 50, paddingHorizontal: 20 },
  md: { height: 40, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 16, fontWeight: "600" },
}));
