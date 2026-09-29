import { Minus, Plus } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PressableScale } from "./Pressable";
import { Sheet } from "./Sheet";
import { colors, fonts, space, type, themed } from "./theme";

/** Smaller / larger buttons for the terminal's text size (you can also pinch the terminal). */
export function TextSizeSheet({
  visible,
  size,
  min,
  max,
  defaultSize,
  onChange,
  onClose,
}: {
  visible: boolean;
  size: number;
  min: number;
  max: number;
  defaultSize: number;
  onChange: (size: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Sheet visible={visible} onClose={onClose} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
      <View style={styles.grabber} />
      <Text style={[type.sub, styles.title]}>Text size · or pinch the terminal</Text>
      <View style={styles.row}>
        <PressableScale
          onPress={() => onChange(Math.max(min, size - 1))}
          disabled={size <= min}
          style={styles.step}
          accessibilityRole="button"
          accessibilityLabel="Smaller text"
        >
          <Minus size={20} color={colors.text} />
        </PressableScale>
        <View style={styles.preview} accessible accessibilityLabel={`Text size ${size}`}>
          <Text style={[styles.sample, { fontSize: size, lineHeight: Math.round(size * 1.45) }]} allowFontScaling={false}>
            Aa
          </Text>
          <Text style={type.caption}>{size === defaultSize ? `${size} · default` : String(size)}</Text>
        </View>
        <PressableScale
          onPress={() => onChange(Math.min(max, size + 1))}
          disabled={size >= max}
          style={styles.step}
          accessibilityRole="button"
          accessibilityLabel="Larger text"
        >
          <Plus size={20} color={colors.text} />
        </PressableScale>
      </View>
      {size !== defaultSize ? (
        <PressableScale onPress={() => onChange(defaultSize)} style={styles.reset} accessibilityRole="button">
          <Text style={type.sub}>Reset to default</Text>
        </PressableScale>
      ) : null}
    </Sheet>
  );
}

const styles = themed(() => StyleSheet.create({
  sheet: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.md },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border },
  title: { paddingHorizontal: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  step: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
  preview: { flex: 1, alignItems: "center", gap: 2 },
  sample: { fontFamily: fonts.mono, color: colors.text },
  reset: { alignSelf: "center", paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: 999 },
}));
