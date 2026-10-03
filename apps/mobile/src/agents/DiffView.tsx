import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { DiffHunk, DiffLine, FileDiff } from "@shepherd/protocol";
import { PressableScale } from "../ui/Pressable";
import { colors, fonts, space, themed } from "../ui/theme";
import { foldContext, type DiffPiece } from "./diff-fold";

/** Hunks shown before "Show all": enough for an overview. */
const FIRST_HUNKS = 3;

function Line({ line, numbers }: { line: DiffLine; numbers: boolean }) {
  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  const number = line.kind === "del" ? line.old : line.new;
  return (
    <View style={[styles.line, line.kind === "add" && styles.add, line.kind === "del" && styles.del]}>
      {numbers ? <Text style={styles.number}>{number ?? ""}</Text> : null}
      <Text style={[styles.sign, line.kind === "add" && styles.addSign, line.kind === "del" && styles.delSign]}>{sign}</Text>
      <Text style={styles.code} selectable>
        {line.text || " "}
      </Text>
    </View>
  );
}

function Fold({ piece, onOpen }: { piece: Extract<DiffPiece, { kind: "fold" }>; onOpen: () => void }) {
  return (
    <PressableScale onPress={onOpen} style={styles.fold} accessibilityRole="button" accessibilityLabel={`Show ${piece.lines.length} unchanged lines`}>
      <Text style={styles.foldText}>⋯ {piece.lines.length} unchanged lines</Text>
    </PressableScale>
  );
}

function Hunk({ hunk, numbers }: { hunk: DiffHunk; numbers: boolean }) {
  const [opened, setOpened] = useState<Set<number>>(new Set());
  return (
    <View>
      {foldContext(hunk.lines).map((piece, i) =>
        piece.kind === "fold" && !opened.has(i) ? (
          <Fold key={i} piece={piece} onOpen={() => setOpened((prev) => new Set(prev).add(i))} />
        ) : (
          piece.lines.map((line, j) => <Line key={`${i}:${j}`} line={line} numbers={numbers} />)
        ),
      )}
    </View>
  );
}

/**
 * A diff for reading on a phone: only what changed (unchanged stretches fold
 * away), one column, wrapped lines, quiet colours.
 */
export function DiffView({ diff, compact = false }: { diff: FileDiff; compact?: boolean }) {
  const [all, setAll] = useState(false);
  if (diff.binary) return <Text style={styles.note}>Binary file: no text to show.</Text>;
  if (diff.hunks.length === 0) return <Text style={styles.note}>{diff.truncated ? "Too big to show here." : "No changes to show."}</Text>;
  const hunks = all ? diff.hunks : diff.hunks.slice(0, FIRST_HUNKS);
  return (
    <View style={[styles.box, compact && styles.compact]}>
      {hunks.map((hunk, i) => (
        <View key={i}>
          {i > 0 || (!compact && hunk.newStart > 1) ? <Text style={styles.at}>{i > 0 ? "⋯" : ""} line {hunk.newStart || hunk.oldStart}</Text> : null}
          <Hunk hunk={hunk} numbers={!compact} />
        </View>
      ))}
      {!all && diff.hunks.length > FIRST_HUNKS ? (
        <PressableScale onPress={() => setAll(true)} style={styles.more} accessibilityRole="button">
          <Text style={styles.moreText}>Show all {diff.hunks.length} changes</Text>
        </PressableScale>
      ) : null}
      {diff.truncated ? <Text style={styles.note}>Cut short: the rest is too big to show here.</Text> : null}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    box: { backgroundColor: colors.terminal, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden", paddingVertical: 4 },
    compact: { borderRadius: 8 },
    line: { flexDirection: "row", paddingHorizontal: 8, paddingVertical: 1 },
    add: { backgroundColor: "rgba(34,197,94,0.10)" },
    del: { backgroundColor: "rgba(248,113,113,0.10)" },
    number: { width: 34, fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 18, color: colors.subtle, textAlign: "right", marginRight: 6 },
    sign: { width: 12, fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: colors.subtle },
    addSign: { color: "#4ADE80" },
    delSign: { color: "#F87171" },
    code: { flex: 1, fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: colors.terminalText },
    fold: { paddingVertical: 6, paddingHorizontal: 12 },
    foldText: { fontFamily: fonts.mono, fontSize: 11, color: colors.subtle },
    at: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.subtle, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2 },
    more: { paddingVertical: 10, alignItems: "center" },
    moreText: { fontSize: 13, fontWeight: "600", color: colors.text },
    note: { fontSize: 12.5, color: colors.muted, padding: space.sm },
  }),
);
