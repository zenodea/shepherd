import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, TextInput } from "react-native";
import { themed } from "../ui/theme";

export type KeyboardCaptureHandle = { focus: () => void; blur: () => void };

// The input starts with a few spaces so that a backspace is visible as a
// shorter value (Android soft keyboards don't reliably report Backspace).
const SENTINEL = "    ";

/**
 * An invisible input that turns what you type into terminal keystrokes:
 * characters as-is, backspace as DEL, Enter as CR. It mirrors the native
 * text (so fast typing never races a reset) and only resets when the buffer
 * runs low or gets long.
 */
export const KeyboardCapture = forwardRef<KeyboardCaptureHandle, { onKeys: (data: string) => void; onActiveChange?: (active: boolean) => void }>(
  function KeyboardCapture({ onKeys, onActiveChange }, ref) {
    const input = useRef<TextInput>(null);
    const [value, setValue] = useState(SENTINEL);
    const last = useRef(SENTINEL);

    useImperativeHandle(ref, () => ({
      focus: () => input.current?.focus(),
      blur: () => input.current?.blur(),
    }));

    return (
      <TextInput
        ref={input}
        style={styles.hidden}
        value={value}
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        keyboardType="visible-password"
        caretHidden
        contextMenuHidden
        submitBehavior="submit"
        onFocus={() => onActiveChange?.(true)}
        onBlur={() => onActiveChange?.(false)}
        onSubmitEditing={() => onKeys("\r")}
        onChangeText={(text) => {
          const prev = last.current;
          let common = 0;
          while (common < text.length && common < prev.length && text[common] === prev[common]) common++;
          const data = "\u007f".repeat(prev.length - common) + text.slice(common).replace(/\n/g, "\r");
          if (data) onKeys(data);
          const next = text.length < 2 || text.length > 64 ? SENTINEL : text;
          last.current = next;
          setValue(next);
        }}
      />
    );
  },
);

const styles = themed(() => StyleSheet.create({
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0, left: -10, bottom: 0 },
}));
