import { StyleSheet, Text } from "react-native";
import { fonts, themed } from "../ui/theme";

/** "+12 −4" in green and red. */
export function Counts({ additions, deletions, size = 12 }: { additions: number; deletions: number; size?: number }) {
  return (
    <Text style={[styles.counts, { fontSize: size }]} numberOfLines={1}>
      {additions ? <Text style={styles.add}>+{additions}</Text> : null}
      {additions && deletions ? " " : ""}
      {deletions ? <Text style={styles.del}>−{deletions}</Text> : null}
    </Text>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    counts: { fontFamily: fonts.mono, flexShrink: 0 },
    add: { color: "#4ADE80" },
    del: { color: "#F87171" },
  }),
);
