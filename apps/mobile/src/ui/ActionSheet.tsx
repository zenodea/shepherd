import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PressableScale } from "./Pressable";
import { colors, space, type } from "./theme";

export type SheetAction = { key?: string; icon: ReactNode; title: string; detail?: string; trailing?: ReactNode; onPress: () => void };

/** A bottom sheet of large actions. Tapping outside closes it. */
export function ActionSheet({ visible, title, actions, onClose }: { visible: boolean; title?: string; actions: SheetAction[]; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <View style={styles.grabber} />
        {title ? <Text style={[type.sub, styles.title]}>{title}</Text> : null}
        {actions.map((action) => (
          <PressableScale
            key={action.key ?? action.title}
            onPress={() => {
              onClose();
              action.onPress();
            }}
            style={styles.action}
          >
            <View style={styles.icon}>{action.icon}</View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.row}>{action.title}</Text>
              {action.detail ? <Text style={type.sub}>{action.detail}</Text> : null}
            </View>
            {action.trailing}
          </PressableScale>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: space.sm },
  title: { paddingHorizontal: space.sm, paddingBottom: space.xs },
  action: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: 14 },
  icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
});
