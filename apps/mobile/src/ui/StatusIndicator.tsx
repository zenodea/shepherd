import { useEffect, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, View } from "react-native";
import type { AgentStatus } from "@shepherd/protocol";
import { colors, statusColors, statusLabels, themed } from "./theme";

// The braille "dots" spinner (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏), drawn as views: the bundled font has
// no braille, and a timer-driven glyph stutters whenever the JS thread is busy.
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"].map((c) => c.charCodeAt(0) - 0x2800);
const FRAME_MS = 80;
const DIM = 0.14;
/** Braille dots 1-6 as [column, row]. */
const DOTS: [number, number][] = [
  [0, 0],
  [0, 1],
  [0, 2],
  [1, 0],
  [1, 1],
  [1, 2],
];

// One clock for every spinner, run by the native driver: they all stay in step
// and keep moving smoothly while JS is busy rendering.
const clock = new Animated.Value(0);
let running: Animated.CompositeAnimation | null = null;
let users = 0;
function useSpinnerClock() {
  useEffect(() => {
    if (users++ === 0) {
      running = Animated.loop(
        Animated.timing(clock, { toValue: FRAMES.length, duration: FRAMES.length * FRAME_MS, easing: Easing.linear, useNativeDriver: Platform.OS !== "web" }),
      );
      running.start();
    }
    return () => {
      if (--users === 0) {
        running?.stop();
        running = null;
        clock.setValue(0);
      }
    };
  }, []);
}

// Each dot's opacity over one loop, easing between frames; the last point
// repeats the first so the loop joins up seamlessly.
const inputRange = [...FRAMES.map((_, i) => i), FRAMES.length];
const dotOpacity = DOTS.map((_, dot) => {
  const outputRange = FRAMES.map((bits) => (bits & (1 << dot) ? 1 : DIM));
  return clock.interpolate({ inputRange, outputRange: [...outputRange, outputRange[0]!] });
});

/** Braille-dot spinner for agents that are working. */
function Spinner({ color, size }: { color: string; size: number }) {
  useSpinnerClock();
  const d = Math.max(2.5, size * 0.36);
  const gap = d * 0.5;
  return (
    <View style={{ width: d * 2 + gap, height: d * 3 + gap * 2 }}>
      {DOTS.map(([col, row], i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute",
            left: col * (d + gap),
            top: row * (d + gap),
            width: d,
            height: d,
            borderRadius: d / 2,
            backgroundColor: color,
            opacity: dotOpacity[i],
          }}
        />
      ))}
    </View>
  );
}

/** A dot with a ring that pulses outward, for agents waiting on you. */
function PingDot({ color, size }: { color: string; size: number }) {
  const [ping] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(ping, { toValue: 1, duration: 1100, useNativeDriver: Platform.OS !== "web" }));
    loop.start();
    return () => loop.stop();
  }, [ping]);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={[
          styles.dot,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color, position: "absolute" },
          { opacity: ping.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }), transform: [{ scale: ping.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }] },
        ]}
      />
      <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]} />
    </View>
  );
}

/** Working: spinner. Needs input: pulsing dot. Done: solid dot. Idle: hollow dot. */
export function StatusIndicator({ status, size = 9 }: { status: AgentStatus; size?: number }) {
  const color = statusColors[status];
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={statusLabels[status]}>
      <Indicator status={status} color={color} size={size} />
    </View>
  );
}

function Indicator({ status, color, size }: { status: AgentStatus; color: string; size: number }) {
  if (status === "working") return <Spinner color={color} size={size} />;
  if (status === "blocked") return <PingDot color={color} size={size} />;
  if (status === "done") return <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]} />;
  return <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: colors.subtle }]} />;
}

const styles = themed(() => StyleSheet.create({
  dot: {},
}));
