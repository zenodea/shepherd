import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { LOGOS } from "./agent-logos";
import { colors, themed } from "./theme";

/** The agent's own logo in a circle; an agent without one gets its initial. */
export function AgentMark({ agent, size = 28 }: { agent: string | null | undefined; size?: number }) {
  const key = (agent ?? "").toLowerCase();
  const logo = LOGOS[key];
  const mark = size * 0.56;
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]} accessibilityLabel={agent ?? undefined}>
      {logo ? (
        <Svg width={mark} height={mark} viewBox={logo.viewBox}>
          {logo.paths.map((p, i) => (
            <Path key={i} d={p.d} fill={p.fill ?? logo.color ?? colors.text} fillRule={p.evenOdd ? "evenodd" : "nonzero"} />
          ))}
        </Svg>
      ) : (
        <Text style={{ color: colors.muted, fontSize: size * 0.48, fontWeight: "700" }}>{(key[0] ?? "?").toUpperCase()}</Text>
      )}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  circle: { backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
}));
