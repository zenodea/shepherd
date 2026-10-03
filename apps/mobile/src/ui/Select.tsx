import { Check, ChevronDown } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ListRow } from "./ListRow";
import { PressableScale } from "./Pressable";
import { Sheet } from "./Sheet";
import { colors, space, type, themed } from "./theme";

export type SelectOption<T extends string> = { value: T; label: string; detail?: string | null; icon?: ReactNode };

/** One row showing the current choice; tapping it opens the options in a sheet. */
export function Select<T extends string>({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: T | null;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const selected = options.find((o) => o.value === value);
  return (
    <>
      <ListRow
        icon={selected?.icon}
        title={selected?.label ?? "Choose…"}
        detail={selected?.detail}
        chevron={false}
        trailing={<ChevronDown size={18} color={colors.subtle} />}
        onPress={() => setOpen(true)}
      />
      <Sheet visible={open} onClose={() => setOpen(false)} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <View style={styles.grabber} />
        <Text style={[type.sub, styles.title]}>{title}</Text>
        <ScrollView style={styles.list}>
          {options.map((option) => (
            <PressableScale
              key={option.value}
              onPress={() => {
                setOpen(false);
                onChange(option.value);
              }}
              style={styles.option}
              accessibilityRole="radio"
              accessibilityState={{ checked: option.value === value }}
            >
              {option.icon ? <View style={styles.icon}>{option.icon}</View> : null}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.row}>{option.label}</Text>
                {option.detail ? <Text style={type.sub}>{option.detail}</Text> : null}
              </View>
              {option.value === value ? <Check size={18} color={colors.text} /> : null}
            </PressableScale>
          ))}
        </ScrollView>
      </Sheet>
    </>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    sheet: { paddingHorizontal: space.md, paddingTop: space.sm, gap: 4 },
    grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: space.sm },
    title: { paddingHorizontal: space.sm, paddingBottom: space.xs },
    list: { flexShrink: 1 },
    option: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: 14 },
    icon: { width: 28, alignItems: "center" },
  }),
);
