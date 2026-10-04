import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { ChevronDown, ChevronUp, Copy, Files, Monitor, Pilcrow, X } from "lucide-react-native";
import { forwardRef, memo, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SPAN_BOLD, SPAN_DIM, SPAN_ITALIC, SPAN_UNDERLINE, type StyledLine, type StyledSpan } from "@shepherd/protocol";
import { ActionSheet } from "../ui/ActionSheet";
import { PressableScale } from "../ui/Pressable";
import { colors, fonts, terminalColor, themeVersion, themed } from "../ui/theme";
import { normalizeGlyphs } from "./glyphs";
import { findLinks, findMatches, lineText, segment, type LineLink } from "./line-marks";

export const DEFAULT_FONT_SIZE = 13;
export const MIN_FONT_SIZE = 9;
export const MAX_FONT_SIZE = 20;
const PAD_H = 12;
const PAD_V = 8;

const lineHeightFor = (fontSize: number) => Math.round(fontSize * 1.45);
export const clampFontSize = (size: number) => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));

export type LiveTerminalHandle = { scrollToBottom: () => void };

type Cursor = { x: number; y: number; visible: boolean };

type Item = { key: string; line: StyledLine; cursorX: number | null; text: string; live: boolean };

function spanStyle(span: StyledSpan) {
  const [, fg, bg, flags] = span;
  return [
    fg ? { color: terminalColor(fg) } : null,
    bg ? { backgroundColor: terminalColor(bg) } : null,
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
      out.push([text[i]!, colors.terminal, colors.terminalText, span[3]]);
      if (i + 1 < text.length) out.push([text.slice(i + 1), span[1], span[2], span[3]]);
      placed = true;
    } else {
      out.push(span);
    }
    col += text.length;
  }
  if (!placed) {
    if (x > col) out.push([" ".repeat(x - col), null, null, 0]);
    out.push([" ", null, colors.terminalText, 0]);
  }
  return out;
}

// One text style per font size (and theme), so memoised rows keep a stable style.
const lineStyles = new Map<string, object>();
function lineStyle(fontSize: number) {
  const key = `${fontSize}:${themeVersion()}`;
  let style = lineStyles.get(key);
  if (!style) {
    style = { fontFamily: fonts.mono, fontSize, lineHeight: lineHeightFor(fontSize), color: colors.terminalText, includeFontPadding: false };
    lineStyles.set(key, style);
  }
  return style;
}

type RowProps = {
  index: number;
  line: StyledLine;
  text: string;
  cursorX: number | null;
  /** The search, if this row has a match ("" otherwise, so other rows don't re-render). */
  query: string;
  current: boolean;
  fontSize: number;
  onLongPress: (index: number) => void;
  onLink: (link: LineLink) => void;
};

const Row = memo(function Row({ index, line, text, cursorX, query, current, fontSize, onLongPress, onLink }: RowProps) {
  const style = lineStyle(fontSize);
  const segments = useMemo(() => {
    const spans = cursorX === null ? line : withCursor(line, cursorX);
    return segment(spans, [...findLinks(text), ...findMatches(text, query, current)]);
  }, [line, text, cursorX, query, current]);
  if (segments.length === 0) {
    return (
      <Text style={style} allowFontScaling={false} onLongPress={() => onLongPress(index)}>
        {" "}
      </Text>
    );
  }
  return (
    <Text style={style} allowFontScaling={false} numberOfLines={0} onLongPress={() => onLongPress(index)} suppressHighlighting>
      {segments.map((seg, i) => (
        <Text
          key={i}
          style={[
            spanStyle(seg.span),
            seg.link && styles.link,
            seg.match === "other" && styles.match,
            seg.match === "current" && styles.matchCurrent,
          ]}
          onPress={seg.link ? () => onLink(seg.link!) : undefined}
          accessibilityRole={seg.link ? "link" : undefined}
        >
          {normalizeGlyphs(seg.span[0])}
        </Text>
      ))}
    </Text>
  );
});

function distance(e: GestureResponderEvent): number {
  const [a, b] = e.nativeEvent.touches;
  return a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0;
}

/**
 * The terminal as a native list: history on top, the live screen at the
 * bottom. Built on FlashList: starts at the bottom and keeps your place while
 * you read. Follows new output only while you're pinned to the bottom: any
 * drag up lets go, and scrolling back down (or `scrollToBottom`) pins again.
 *
 * Long-press a line to copy it; tap a link to open it or a file path to copy
 * it; pinch to change the text size; `searching` shows a find bar.
 */
export const LiveTerminal = forwardRef<
  LiveTerminalHandle,
  {
    history: StyledLine[];
    screen: StyledLine[];
    cursor: Cursor | null;
    fontSize: number;
    onFontSizeChange: (size: number) => void;
    /** How many columns and rows fit; rows only grow, so the keyboard doesn't resize the pane. */
    onSize: (cols: number, rows: number) => void;
    onAtBottomChange: (atBottom: boolean) => void;
    searching: boolean;
    onCloseSearch: () => void;
  }
>(function LiveTerminal({ history, screen, cursor, fontSize, onFontSizeChange, onSize, onAtBottomChange, searching, onCloseSearch }, ref) {
  const list = useRef<FlashListRef<Item>>(null);
  const [charWidth, setCharWidth] = useState<number | null>(null);
  const layout = useRef<{ width: number; height: number } | null>(null);
  const reported = useRef<{ width: number; rows: number; charWidth: number } | null>(null);
  const atBottom = useRef(true);
  const following = useRef(true);
  const lineHeight = lineHeightFor(fontSize);

  // Kept after closing, so the sheet keeps its content while it slides away.
  const [copying, setCopying] = useState<{ index: number; items: Item[] } | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [query, setQuery] = useState("");
  // Which match is selected, counted from the newest (0 = the last match).
  const [fromEnd, setFromEnd] = useState(0);

  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      following.current = true;
      list.current?.scrollToEnd({ animated: true });
    },
  }));

  // History keys count from the bottom, so older lines arriving on top don't move your place.
  const past = useMemo(
    () => history.map((line, i): Item => ({ key: `h${history.length - i}`, line, cursorX: null, text: lineText(line), live: false })),
    [history],
  );
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
      text: lineText(line),
      live: true,
    }));
    return [...past, ...live];
  }, [past, screen, cursor]);

  // --- search -----------------------------------------------------------------
  const activeQuery = searching ? query.trim() : "";
  const matches = useMemo(() => {
    if (!activeQuery) return [];
    const needle = activeQuery.toLowerCase();
    const found: number[] = [];
    items.forEach((item, i) => {
      if (item.text.toLowerCase().includes(needle)) found.push(i);
    });
    return found;
  }, [items, activeQuery]);
  const currentPos = matches.length > 0 ? Math.max(0, matches.length - 1 - Math.min(fromEnd, matches.length - 1)) : -1;
  const currentIndex = currentPos >= 0 ? matches[currentPos]! : -1;
  const matchSet = useMemo(() => new Set(matches), [matches]);

  const goTo = (pos: number) => {
    const index = matches[pos];
    if (index === undefined) return;
    following.current = false;
    list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
  };
  const step = (older: boolean) => {
    if (matches.length === 0) return;
    const next = Math.min(matches.length - 1, Math.max(0, fromEnd + (older ? 1 : -1)));
    setFromEnd(next);
    goTo(matches.length - 1 - next);
  };

  // --- copying and links --------------------------------------------------------
  const flash = useCallback((message: string) => {
    if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1400);
  }, []);

  const copy = useCallback(
    (text: string, message = "Copied") => {
      void Clipboard.setStringAsync(text).then(() => flash(message));
    },
    [flash],
  );

  // Rows are memoised, so these handlers must stay stable; they read the latest items through state.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onLongPress = useCallback((index: number) => {
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setCopying({ index, items: itemsRef.current });
    setCopyOpen(true);
  }, []);
  const onLink = useCallback(
    (link: LineLink) => {
      if (link.kind === "url") void Linking.openURL(link.value).catch(() => copy(link.value, "Copied link"));
      else copy(link.value, "Copied path");
    },
    [copy],
  );

  const copyActions = (() => {
    if (!copying) return [];
    const { index, items: snapshot } = copying;
    const text = (from: number, to: number) =>
      snapshot
        .slice(from, to + 1)
        .map((i) => i.text.trimEnd())
        .join("\n")
        .replace(/^\n+|\n+$/g, "");
    let start = index;
    let end = index;
    while (start > 0 && snapshot[start - 1]!.text.trim()) start--;
    while (end < snapshot.length - 1 && snapshot[end + 1]!.text.trim()) end++;
    const firstLive = snapshot.findIndex((i) => i.live);
    return [
      { icon: <Copy size={19} color={colors.text} />, title: "Copy line", onPress: () => copy(text(index, index)) },
      { icon: <Pilcrow size={19} color={colors.text} />, title: "Copy paragraph", detail: `${end - start + 1} lines`, onPress: () => copy(text(start, end)) },
      ...(firstLive >= 0
        ? [{ icon: <Monitor size={19} color={colors.text} />, title: "Copy screen", onPress: () => copy(text(firstLive, snapshot.length - 1)) }]
        : []),
      { icon: <Files size={19} color={colors.text} />, title: "Copy everything", detail: `${snapshot.length} lines`, onPress: () => copy(text(0, snapshot.length - 1)) },
    ];
  })();

  // --- size --------------------------------------------------------------------
  const report = useCallback(
    (cw: number) => {
      const box = layout.current;
      if (!box || cw <= 0) return;
      const cols = Math.max(20, Math.floor((box.width - PAD_H * 2) / cw));
      const rows = Math.max(8, Math.floor((box.height - PAD_V * 2) / lineHeight));
      const prev = reported.current;
      // Rows only grow for a given width and font: the keyboard shrinking the
      // view shouldn't resize the pane on your computer.
      if (prev && prev.width === box.width && prev.charWidth === cw && rows <= prev.rows) return;
      reported.current = { width: box.width, rows: prev && prev.width === box.width && prev.charWidth === cw ? Math.max(rows, prev.rows) : rows, charWidth: cw };
      onSize(cols, reported.current.rows);
    },
    [onSize, lineHeight],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    layout.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
    if (charWidth) report(charWidth);
  };

  // Pinch to zoom: the list scales while your fingers move, and the text size
  // (and so the pane's columns) changes once, when you let go.
  const [pinch] = useState(() => new Animated.Value(1));
  const pinchStart = useRef<{ distance: number; ratio: number } | null>(null);
  const twoFingers = (e: GestureResponderEvent) => e.nativeEvent.touches.length === 2;
  const pinchRatio = (ratio: number) => clampFontSize(fontSize * ratio) / fontSize;

  // --- scrolling -----------------------------------------------------------------
  const isNearBottom = ({ contentOffset, contentSize, layoutMeasurement }: NativeScrollEvent) =>
    contentOffset.y + layoutMeasurement.height >= contentSize.height - lineHeight * 2;

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
    <View
      style={styles.container}
      onLayout={onLayout}
      onStartShouldSetResponderCapture={twoFingers}
      onMoveShouldSetResponderCapture={twoFingers}
      onResponderGrant={(e) => {
        pinchStart.current = { distance: distance(e), ratio: 1 };
      }}
      onResponderMove={(e) => {
        const start = pinchStart.current;
        const d = distance(e);
        if (!start || !start.distance || !d) return;
        start.ratio = pinchRatio(d / start.distance);
        pinch.setValue(start.ratio);
      }}
      onResponderRelease={() => {
        const ratio = pinchStart.current?.ratio ?? 1;
        pinchStart.current = null;
        pinch.setValue(1);
        const size = clampFontSize(fontSize * ratio);
        if (size !== fontSize) onFontSizeChange(size);
      }}
      onResponderTerminationRequest={() => false}
    >
      {/* Measures one monospace cell at the terminal font (re-measures when the size changes). */}
      <Text
        style={[lineStyle(fontSize), styles.probe]}
        allowFontScaling={false}
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
      <Animated.View style={{ flex: 1, transform: [{ scale: pinch }] }}>
        <FlashList
          ref={list}
          data={items}
          keyExtractor={(item) => item.key}
          extraData={fontSize}
          renderItem={({ item, index }) => (
            <Row
              index={index}
              line={item.line}
              text={item.text}
              cursorX={item.cursorX}
              query={matchSet.has(index) ? activeQuery : ""}
              current={index === currentIndex}
              fontSize={fontSize}
              onLongPress={onLongPress}
              onLink={onLink}
            />
          )}
          contentContainerStyle={styles.content}
          maintainVisibleContentPosition={{ startRenderingFromBottom: true }}
          onContentSizeChange={() => {
            if (following.current) list.current?.scrollToEnd({ animated: false });
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScrollBeginDrag={() => {
            following.current = false;
            if (!searching) Keyboard.dismiss();
          }}
          onScrollEndDrag={onDragEnd}
          onMomentumScrollEnd={onScrollSettled}
          overScrollMode="always"
          scrollEventThrottle={32}
          onScroll={onScroll}
          showsVerticalScrollIndicator
          indicatorStyle="white"
          accessibilityLabel="Terminal output"
        />
      </Animated.View>

      {searching ? (
        <View style={styles.search}>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={(q) => {
              setQuery(q);
              setFromEnd(0);
            }}
            onSubmitEditing={() => step(true)}
            placeholder="Find in terminal"
            placeholderTextColor={colors.subtle}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            submitBehavior="submit"
            accessibilityLabel="Find in terminal"
          />
          <Text style={styles.searchCount} maxFontSizeMultiplier={1.3}>
            {activeQuery ? (matches.length ? `${currentPos + 1}/${matches.length}` : "0") : ""}
          </Text>
          <PressableScale onPress={() => step(true)} style={styles.searchButton} accessibilityRole="button" accessibilityLabel="Previous match">
            <ChevronUp size={18} color={colors.text} />
          </PressableScale>
          <PressableScale onPress={() => step(false)} style={styles.searchButton} accessibilityRole="button" accessibilityLabel="Next match">
            <ChevronDown size={18} color={colors.text} />
          </PressableScale>
          <PressableScale
            onPress={() => {
              setQuery("");
              onCloseSearch();
            }}
            style={styles.searchButton}
            accessibilityRole="button"
            accessibilityLabel="Close search"
          >
            <X size={17} color={colors.muted} />
          </PressableScale>
        </View>
      ) : null}

      {toast ? (
        <View style={styles.toast} pointerEvents="none" accessibilityLiveRegion="polite">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      <ActionSheet visible={copyOpen} title="Copy" actions={copyActions} onClose={() => setCopyOpen(false)} />
    </View>
  );
});

const styles = themed(() => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.terminal },
  content: { paddingHorizontal: PAD_H, paddingTop: PAD_V, paddingBottom: PAD_V },
  probe: { position: "absolute", opacity: 0, left: -9999 },
  bold: { fontFamily: fonts.monoBold },
  dim: { opacity: 0.6 },
  italic: { fontStyle: "italic" },
  underline: { textDecorationLine: "underline" },
  link: { textDecorationLine: "underline", textDecorationColor: colors.link },
  match: { backgroundColor: colors.match },
  matchCurrent: { backgroundColor: colors.brand, color: colors.terminal },
  search: {
    position: "absolute",
    top: 8,
    left: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: colors.floating,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.edge,
    paddingLeft: 12,
    paddingRight: 4,
    height: 44,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 8 },
  searchCount: { fontSize: 12.5, color: colors.muted, fontFamily: fonts.mono, marginHorizontal: 6 },
  searchButton: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  toast: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.floating,
  },
  toastText: { fontSize: 13, color: colors.text, fontWeight: "500" },
}));
