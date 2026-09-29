import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { forwardRef, memo, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Keyboard, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { SPAN_BOLD, SPAN_DIM, SPAN_ITALIC, SPAN_UNDERLINE, type StyledLine, type StyledSpan } from "@sheperd/protocol";
import { colors, fonts } from "../ui/theme";
import { normalizeGlyphs } from "./glyphs";

export const TERMINAL_FONT_SIZE = 13;
const LINE_HEIGHT = Math.round(TERMINAL_FONT_SIZE * 1.45);
const PAD_H = 12;
const PAD_V = 8;
const CURSOR = "#E5E5E5";
const FOREGROUND = "#E5E5E5";

export type LiveTerminalHandle = { scrollToBottom: () => void };

type Cursor = { x: number; y: number; visible: boolean };

type Item = { key: string; line: StyledLine; cursorX: number | null };

function spanStyle(span: StyledSpan) {
  const [, fg, bg, flags] = span;
  return [
    fg ? { color: fg } : null,
    bg ? { backgroundColor: bg } : null,
    flags & SPAN_BOLD ? styles.bold : null,
    flags & SPAN_DIM ? styles.dim : null,
    flags & SPAN_ITALIC ? styles.italic : null,
    flags & SPAN_UNDERLINE ? styles.underline : null,
  ];
}

/** Split spans so the cell at `x` can be drawn as a cursor block. */
function withCursor(line: StyledLine, x: number): StyledLine {
  const out: StyledSpan[] = [];
  let col = 0;
  let placed = false;
  for (const span of line) {
    const [text] = span;
    if (!placed && x >= col && x < col + text.length) {
      const i = x - col;
      if (i > 0) out.push([text.slice(0, i), span[1], span[2], span[3]]);
      out.push([text[i]!, "#0A0A0A", CURSOR, span[3]]);
      if (i + 1 < text.length) out.push([text.slice(i + 1), span[1], span[2], span[3]]);
      placed = true;
    } else {
      out.push(span);
    }
    col += text.length;
  }
  if (!placed) {
    if (x > col) out.push([" ".repeat(x - col), null, null, 0]);
    out.push([" ", null, CURSOR, 0]);
  }
  return out;
}

const Row = memo(function Row({ line, cursorX }: { line: StyledLine; cursorX: number | null }) {
  const spans = cursorX === null ? line : withCursor(line, cursorX);
  if (spans.length === 0) return <Text style={styles.line}> </Text>;
  return (
    <Text style={styles.line} numberOfLines={0}>
      {spans.map((span, i) => (
        <Text key={i} style={spanStyle(span)}>
          {normalizeGlyphs(span[0])}
        </Text>
      ))}
    </Text>
  );
});

/**
 * The terminal as a native list: history on top, the live screen at the
 * bottom. Built on FlashList: starts at the bottom and keeps your place while
 * you read. Follows new output only while you're pinned to the bottom: any
 * drag up lets go, and scrolling back down (or `scrollToBottom`) pins again.
 */
export const LiveTerminal = forwardRef<
  LiveTerminalHandle,
  {
    history: StyledLine[];
    screen: StyledLine[];
    cursor: Cursor | null;
    /** How many columns and rows fit; rows only grow, so the keyboard doesn't resize the pane. */
    onSize: (cols: number, rows: number) => void;
    onAtBottomChange: (atBottom: boolean) => void;
  }
>(function LiveTerminal({ history, screen, cursor, onSize, onAtBottomChange }, ref) {
  const list = useRef<FlashListRef<Item>>(null);
  const [charWidth, setCharWidth] = useState<number | null>(null);
  const layout = useRef<{ width: number; height: number } | null>(null);
  const reported = useRef<{ width: number; rows: number; charWidth: number } | null>(null);
  const atBottom = useRef(true);
  const following = useRef(true);

  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      following.current = true;
      list.current?.scrollToEnd({ animated: true });
    },
  }));

  // Rows below the last line with content (and the cursor) are blank screen;
  // leaving them out keeps the newest line at the bottom, like a chat.
  const items = useMemo(() => {
    let last = -1;
    screen.forEach((line, y) => {
      if (line.length > 0) last = y;
    });
    if (cursor?.visible) last = Math.max(last, cursor.y);
    const live: Item[] = screen.slice(0, last + 1).map((line, y) => ({
      key: `s${y}`,
      line,
      cursorX: cursor?.visible && cursor.y === y ? cursor.x : null,
    }));
    // History keys count from the bottom, so older lines arriving on top don't move your place.
    return [...history.map((line, i): Item => ({ key: `h${history.length - i}`, line, cursorX: null })), ...live];
  }, [history, screen, cursor]);

  const report = useCallback(
    (cw: number) => {
      const box = layout.current;
      if (!box || cw <= 0) return;
      const cols = Math.max(20, Math.floor((box.width - PAD_H * 2) / cw));
      const rows = Math.max(8, Math.floor((box.height - PAD_V * 2) / LINE_HEIGHT));
      const prev = reported.current;
      // Rows only grow for a given width and font: the keyboard shrinking the
      // view shouldn't resize the pane on your computer.
      if (prev && prev.width === box.width && prev.charWidth === cw && rows <= prev.rows) return;
      reported.current = { width: box.width, rows: prev && prev.width === box.width && prev.charWidth === cw ? Math.max(rows, prev.rows) : rows, charWidth: cw };
      onSize(cols, reported.current.rows);
    },
    [onSize],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    layout.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
    if (charWidth) report(charWidth);
  };

  const isNearBottom = ({ contentOffset, contentSize, layoutMeasurement }: NativeScrollEvent) =>
    contentOffset.y + layoutMeasurement.height >= contentSize.height - LINE_HEIGHT * 2;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const bottom = isNearBottom(e.nativeEvent);
    if (bottom !== atBottom.current) {
      atBottom.current = bottom;
      onAtBottomChange(bottom);
    }
  };

  // Where a drag (or its fling) comes to rest decides whether to follow again.
  const onScrollSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    following.current = isNearBottom(e.nativeEvent);
  };
  const onDragEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const flung = Math.abs(e.nativeEvent.velocity?.y ?? 0) > 0.1;
    if (!flung) onScrollSettled(e);
  };

  return (
    <View style={styles.container} onLayout={onLayout}>
      {/* Measures one monospace cell at the terminal font (re-measures once the font loads). */}
      <Text
        style={[styles.line, styles.probe]}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width / 40;
          if (w > 0 && Math.abs(w - (charWidth ?? 0)) > 0.01) {
            setCharWidth(w);
            report(w);
          }
        }}
      >
        {"M".repeat(40)}
      </Text>
      <FlashList
        ref={list}
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <Row line={item.line} cursorX={item.cursorX} />}
        contentContainerStyle={styles.content}
        maintainVisibleContentPosition={{ startRenderingFromBottom: true }}
        onContentSizeChange={() => {
          if (following.current) list.current?.scrollToEnd({ animated: false });
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={() => {
          following.current = false;
          Keyboard.dismiss();
        }}
        onScrollEndDrag={onDragEnd}
        onMomentumScrollEnd={onScrollSettled}
        overScrollMode="always"
        scrollEventThrottle={32}
        onScroll={onScroll}
        showsVerticalScrollIndicator
        indicatorStyle="white"
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.terminal },
  content: { paddingHorizontal: PAD_H, paddingTop: PAD_V, paddingBottom: PAD_V },
  line: { fontFamily: fonts.mono, fontSize: TERMINAL_FONT_SIZE, lineHeight: LINE_HEIGHT, color: FOREGROUND, includeFontPadding: false },
  probe: { position: "absolute", opacity: 0, left: -9999 },
  bold: { fontFamily: fonts.monoBold },
  dim: { opacity: 0.6 },
  italic: { fontStyle: "italic" },
  underline: { textDecorationLine: "underline" },
});
