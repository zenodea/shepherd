import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { colors, radii, space, type, themed } from "./theme";

/** Asks for one line of text, e.g. a new name. (Android has no Alert.prompt.) */
export function PromptSheet({
  visible,
  title,
  initial = "",
  placeholder,
  action = "Save",
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  initial?: string;
  placeholder?: string;
  action?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Sheet visible={visible} onClose={onClose} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
      {/* Keyed so each opening starts from the current value. */}
      <Body key={initial} title={title} initial={initial} placeholder={placeholder} action={action} onSubmit={onSubmit} onClose={onClose} />
    </Sheet>
  );
}

function Body({
  title,
  initial,
  placeholder,
  action,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: string;
  placeholder?: string;
  action: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const submit = () => {
    if (!value.trim()) return;
    onClose();
    onSubmit(value.trim());
  };
  return (
    <>
      <Text style={[type.section, { paddingHorizontal: 4 }]}>{title}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={colors.subtle}
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <View style={styles.buttons}>
        <Button title="Cancel" variant="ghost" size="md" onPress={onClose} style={{ flex: 1 }} />
        <Button title={action} size="md" onPress={submit} disabled={!value.trim()} style={{ flex: 1 }} />
      </View>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  sheet: { padding: space.lg, gap: space.md },
  input: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  buttons: { flexDirection: "row", gap: space.sm },
}));
