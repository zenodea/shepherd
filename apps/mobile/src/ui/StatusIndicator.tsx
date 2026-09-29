import { useEffect, useState } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";
import type { AgentStatus } from "@sheperd/protocol";
import { colors, fonts, statusColors } from "./theme";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Braille spinner for agents that are working. */
function Spinner({ color, size }: { color: string; size: number }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(timer);
  }, []);
  return <Text style={{ color, fontFamily: fonts.mono, fontSize: size, lineHeight: size + 2 }}>{SPINNER[frame]}</Text>;
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
  if (status === "working") return <Spinner color={color} size={Math.round(size * 2)} />;
  if (status === "blocked") return <PingDot color={color} size={size} />;
  if (status === "done") return <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]} />;
  return <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: colors.subtle }]} />;
}

const styles = StyleSheet.create({
  dot: {},
});
