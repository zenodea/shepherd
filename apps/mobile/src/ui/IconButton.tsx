import type { ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { PressableScale } from "./Pressable";
import { colors } from "./theme";

/** Round icon button, like header actions. */
export function IconButton({
  children,
  onPress,
  size = 36,
  filled = true,
  label,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  size?: number;
  filled?: boolean;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={[styles.base, { width: size, height: size, borderRadius: size / 2 }, filled && styles.filled, style]}
    >
      {children}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  filled: { backgroundColor: colors.raised },
});
