import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, Platform, type StyleProp, type ViewStyle } from "react-native";

const native = Platform.OS !== "web";

/** Pops in with a little bounce when `visible`, and shrinks away when not; untouchable while hidden. */
export function Appear({ visible, style, children }: { visible: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const [shown] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = visible
      ? Animated.spring(shown, { toValue: 1, friction: 6, tension: 140, useNativeDriver: native })
      : Animated.timing(shown, { toValue: 0, duration: 140, easing: Easing.in(Easing.cubic), useNativeDriver: native });
    animation.start();
    return () => animation.stop();
  }, [visible, shown]);
  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      style={[
        style,
        {
          opacity: shown.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1], extrapolate: "clamp" }),
          transform: [
            { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
            { scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
