import { memo, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { DiffLine, FileDiff } from "@shepherd/protocol";
import { PressableScale } from "../ui/Pressable";
import { colors, fonts, space, themed } from "../ui/theme";
import { diffRows, type DiffRow, type Span, type TokenKind } from "./diff-rows";

/** Hunks shown before "Show all" in the chat's compact diffs: enough for an overview. */
const FIRST_HUNKS = 3;

const tokenColor = (kind: TokenKind | null): string | undefined =>
  kind === "keyword" ? colors.syntaxKeyword : kind === "string" ? colors.syntaxString : kind === "number" ? colors.syntaxNumber : kind === "comment" ? colors.subtle : undefined;

function Code({ spans, kind }: { spans: Span[]; kind: DiffLine["kind"] }) {
  return (
    <Text style={styles.code} selectable>
      {spans.length === 0
        ? " "
        : spans.map((s, i) => (
            <Text key={i} style={[s.kind ? { color: tokenColor(s.kind) } : null, s.changed && (kind === "add" ? styles.addWord : styles.delWord)]}>
              {s.text}
            </Text>
          ))}
    </Text>
  );
}

/** One line of a diff: its number, + or −, and the code. `onPress` makes it tappable (to comment on it). */
export const DiffLineRow = memo(function DiffLineRow({ row, numbers, selected, onPress }: { row: Extract<DiffRow, { kind: "line" }>; numbers: boolean; selected?: boolean; onPress?: () => void }) {
  const { line } = row;
  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  const body = (
    <>
      {numbers ? <Text style={styles.number}>{(line.kind === "del" ? line.old : line.new) ?? ""}</Text> : null}
      <Text style={[styles.sign, line.kind === "add" && styles.addSign, line.kind === "del" && styles.delSign]}>{sign}</Text>
      <Code spans={row.spans} kind={line.kind} />
    </>
  );
  const style = [styles.line, line.kind === "add" && styles.add, line.kind === "del" && styles.del, selected && styles.selected];
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [style, pressed && styles.selected]} accessibilityRole="button" accessibilityLabel={`Line ${line.new ?? line.old}: ${line.text}. Comment on it`}>
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
  );
});

export function DiffFoldRow({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <PressableScale onPress={onOpen} style={styles.fold} accessibilityLabel={`Show ${count} unchanged lines`}>
      <Text style={styles.foldText}>⋯ {count} unchanged lines</Text>
    </PressableScale>
  );
}

export function DiffHunkRow({ line }: { line: number }) {
  return <Text style={styles.at}>line {line}</Text>;
}

/** The rows of a diff, with folds that open when tapped. */
export function useDiffRows(diff: FileDiff | null): { rows: DiffRow[]; open: (key: string) => void } {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => (diff ? diffRows(diff, opened) : []), [diff, opened]);
  return { rows, open: (key) => setOpened((prev) => new Set(prev).add(key)) };
}

export function DiffNote({ diff }: { diff: FileDiff }): ReactNode {
  if (diff.binary) return <Text style={styles.note}>Binary file: no text to show.</Text>;
  if (diff.hunks.length === 0) return <Text style={styles.note}>{diff.truncated ? "Too big to show here." : "No changes to show."}</Text>;
  return null;
}

/**
 * A short diff inside the chat (what an edit changed): only what changed,
 * one column, wrapped lines, light colouring and the changed words marked.
 */
export function DiffView({ diff }: { diff: FileDiff }) {
  const [all, setAll] = useState(false);
  const shown = useMemo(() => (all ? diff : { ...diff, hunks: diff.hunks.slice(0, FIRST_HUNKS) }), [diff, all]);
  const { rows, open } = useDiffRows(shown);
  const note = DiffNote({ diff });
  if (note) return note;
  return (
    <View style={[styles.box, styles.compact]}>
      {rows.map((row) =>
        row.kind === "line" ? (
          <DiffLineRow key={row.key} row={row} numbers={false} />
        ) : row.kind === "fold" ? (
          <DiffFoldRow key={row.key} count={row.count} onOpen={() => open(row.key)} />
        ) : (
          <DiffHunkRow key={row.key} line={row.line} />
        ),
      )}
      {!all && diff.hunks.length > FIRST_HUNKS ? (
        <PressableScale onPress={() => setAll(true)} style={styles.more}>
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
    line: { flexDirection: "row", paddingHorizontal: 8, paddingVertical: 1, backgroundColor: colors.terminal },
    add: { backgroundColor: "rgba(34,197,94,0.10)" },
    del: { backgroundColor: "rgba(248,113,113,0.10)" },
    selected: { backgroundColor: "rgba(120,140,255,0.22)" },
    addWord: { backgroundColor: "rgba(34,197,94,0.30)" },
    delWord: { backgroundColor: "rgba(248,113,113,0.30)" },
    number: { width: 34, fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 18, color: colors.subtle, textAlign: "right", marginRight: 6 },
    sign: { width: 12, fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: colors.subtle },
    addSign: { color: "#4ADE80" },
    delSign: { color: "#F87171" },
    code: { flex: 1, fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: colors.terminalText },
    fold: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: colors.terminal },
    foldText: { fontFamily: fonts.mono, fontSize: 11, color: colors.subtle },
    at: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.subtle, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 3, backgroundColor: colors.terminal },
    more: { paddingVertical: 10, alignItems: "center" },
    moreText: { fontSize: 13, fontWeight: "600", color: colors.text },
    note: { fontSize: 12.5, color: colors.muted, padding: space.sm },
  }),
);
