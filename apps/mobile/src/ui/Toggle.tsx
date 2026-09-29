import { Switch } from "react-native";
import { colors } from "./theme";

/** The app's switch: white when on. */
export function Toggle({ value, onValueChange, disabled }: { value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: colors.border, true: colors.text }}
      thumbColor={value ? colors.onPrimary : colors.muted}
    />
  );
}
