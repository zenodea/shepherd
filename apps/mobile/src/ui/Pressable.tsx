import * as Haptics from "expo-haptics";
import { useState, type ReactNode } from "react";
import { Animated, Platform, Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "./theme";

// The style (including absolute positioning) must sit on the Pressable itself:
// Android only delivers touches inside a view's parent bounds, so a
// positioned child of an unstyled Pressable can't be tapped.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  /** Light tap feedback (default true). */
  haptic?: boolean;
  /** Tint the surface while pressed (default true). */
  highlight?: boolean;
};

/** Pressable that shrinks slightly and highlights, with a light haptic tick. */
const CORNERS = ["borderRadius", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"] as const;

/** The button's own corner rounding: Android doesn't always clip children to it while the button scales. */
function corners(style: StyleProp<ViewStyle>): ViewStyle {
  const flat = StyleSheet.flatten(style) ?? {};
  return Object.fromEntries(CORNERS.filter((k) => flat[k] !== undefined).map((k) => [k, flat[k]]));
}

export function PressableScale({ style, children, haptic = true, highlight = true, onPressIn, onPressOut, onPress, disabled, ...rest }: Props) {
  const [scale] = useState(() => new Animated.Value(1));
  const [overlay] = useState(() => new Animated.Value(0));
  const native = Platform.OS !== "web";

  const animate = (to: number, duration: number) =>
    Animated.parallel([
      Animated.timing(scale, { toValue: to === 1 ? 0.975 : 1, duration, useNativeDriver: native }),
      Animated.timing(overlay, { toValue: to, duration, useNativeDriver: native }),
    ]).start();

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      style={[style, { transform: [{ scale }], opacity: disabled ? 0.45 : 1 }, highlight && { overflow: "hidden" }]}
      onPressIn={(e) => {
        animate(1, 80);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        animate(0, 250);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic && Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
    >
      {children}
      {highlight ? (
        <Animated.View
          pointerEvents="none"
          style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.pressed, opacity: overlay }, corners(style)]}
        />
      ) : null}
    </AnimatedPressable>
  );
}
