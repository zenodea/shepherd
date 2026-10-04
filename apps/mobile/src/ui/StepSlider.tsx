import { useEffect, useState } from "react";
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { colors, themed } from "./theme";

const MOVE_MS = 180;

/**
 * A one-line slider over a few named steps: tap a step or drag along the
 * track. The thumb follows your finger; `onChange` fires when you let go.
 */
export function StepSlider({
  steps,
  value,
  busy = false,
  onChange,
  label,
}: {
  steps: { key: string; label: string }[];
  value: string | null;
  busy?: boolean;
  onChange: (key: string) => void;
  label: string;
}) {
  const [width, setWidth] = useState(0);
  const [x] = useState(() => new Animated.Value(0));
  const index = steps.findIndex((s) => s.key === value);
  const [dragged, setDragged] = useState<number | null>(null);
  const shown = dragged ?? index;
  const step = steps.length ? width / steps.length : 0;

  useEffect(() => {
    if (shown < 0 || !step) return;
    Animated.timing(x, { toValue: shown * step, duration: MOVE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [shown, step, x]);

  const at = (locationX: number) => Math.max(0, Math.min(steps.length - 1, Math.floor(locationX / Math.max(step, 1))));
  const release = (locationX: number) => {
    const chosen = at(locationX);
    setDragged(null);
    if (chosen !== index) onChange(steps[chosen]!.key);
  };

  return (
    <View
      style={styles.track}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: steps[index]?.label ?? "" }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        const next = index + (e.nativeEvent.actionName === "increment" ? 1 : -1);
        if (steps[next]) onChange(steps[next].key);
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => setDragged(at(e.nativeEvent.locationX))}
      onResponderMove={(e) => setDragged(at(e.nativeEvent.locationX))}
      onResponderRelease={(e) => release(e.nativeEvent.locationX)}
      onResponderTerminate={() => setDragged(null)}
    >
      {shown >= 0 && step ? <Animated.View pointerEvents="none" style={[styles.thumb, { width: step, transform: [{ translateX: x }] }]} /> : null}
      {steps.map((s, i) => (
        <View key={s.key} style={styles.step} pointerEvents="none">
          {busy && i === index && dragged === null ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <Text style={[styles.text, i === shown && styles.textOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {s.label}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    track: { flexDirection: "row", height: 36, borderRadius: 18, backgroundColor: colors.raised, overflow: "hidden" },
    thumb: { position: "absolute", top: 0, bottom: 0, left: 0, borderRadius: 18, backgroundColor: colors.text },
    step: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
    text: { color: colors.muted, fontSize: 13.5, fontWeight: "500" },
    textOn: { color: colors.background, fontWeight: "600" },
  }),
);
