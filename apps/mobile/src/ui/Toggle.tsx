import { Switch } from "react-native";
import { colors } from "./theme";

/** The app's switch: the accent colour when on. */
export function Toggle({ value, onValueChange, disabled }: { value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: colors.border, true: colors.brand }}
      thumbColor={value ? "#FFFFFF" : colors.dark ? colors.muted : "#FFFFFF"}
      ios_backgroundColor={colors.border}
    />
  );
}
