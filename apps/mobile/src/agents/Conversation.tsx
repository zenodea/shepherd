import { ArrowDown, ChevronDown, ChevronRight, ChevronUp, Clock } from "lucide-react-native";
import { createContext, forwardRef, memo, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, FlatList, Platform, ScrollView, StyleSheet, Text, View, type ViewToken } from "react-native";
import type { ConversationEntry, QueuedMessage } from "@shepherd/protocol";
import { PressableScale } from "../ui/Pressable";
import { Counts } from "./Counts";
import { ConversationImages } from "./ConversationImage";
import { SubagentCard, SubagentsContext } from "./SubagentCard";
import { DiffView } from "./DiffView";
import { colors, fonts, space, statusColors, themed } from "../ui/theme";
import { conversationRows, countUserMessages, groupActivity, queuedRows, rowImages, userMessageIndex, type Row } from "./conversation-rows";
import { Markdown } from "./Markdown";

/**
 * Called with how much a row grew or shrank when you opened or closed it. The
 * list is anchored at the bottom, so a row that grows would push its own title
 * up; the list scrolls by the same amount to keep the title where you tapped it.
 */
const GrowContext = createContext<((delta: number) => void) | null>(null);

/** A view's height straight from the committed layout (new architecture and web), or null where that isn't available. */
function heightNow(view: View | null): number | null {
  const rect = (view as unknown as { getBoundingClientRect?: () => { height: number } } | null)?.getBoundingClientRect?.();
  return rect && rect.height > 0 ? rect.height : null;
}

function Expandable({ title, children, defaultOpen = false }: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const grow = useContext(GrowContext);
  const box = useRef<View>(null);
  const height = useRef(0);
  /** Height before a tap, until the list has been scrolled to make up for the change. */
  const before = useRef<number | null>(null);
  /** The fallback: correct once the new height is reported (a frame late, so it shows). */
  const lateFix = useRef(false);

  // Right after the opened (or closed) row is committed, before it's drawn: read its new
  // height and scroll by the difference. The scroll reaches Android in the same batch as
  // the change (view commands run first), so the frame where the title jumps is never shown.
  useLayoutEffect(() => {
    const was = before.current;
    if (was === null) return;
    before.current = null;
    const now = heightNow(box.current);
    if (now === null) lateFix.current = true;
    else if (now !== was) grow?.(now - was);
  }, [open, grow]);

  return (
    <View
      ref={box}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (lateFix.current && height.current && h !== height.current) grow?.(h - height.current);
        lateFix.current = false;
        height.current = h;
      }}
    >
      <PressableScale
        onPress={() => {
          before.current = heightNow(box.current) ?? height.current;
          setOpen((o) => !o);
        }}
        style={styles.expandHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
          <ChevronRight size={14} color={colors.subtle} />
        </View>
        {title}
      </PressableScale>
      {open ? <View style={styles.expandBody}>{children}</View> : null}
    </View>
  );
}

function Output({ text }: { text: string }) {
  return (
    <ScrollView horizontal style={styles.codeBlock} contentContainerStyle={styles.codeBlockInner}>
      <Text style={styles.code} selectable>
        {text || "(no output)"}
      </Text>
    </ScrollView>
  );
}

const RowView = memo(function RowView({ row }: { row: Row }) {
  const subagents = useContext(SubagentsContext);
  if (row.kind === "tool" && row.call.subagent && subagents?.byId.has(row.call.subagent)) {
    return (
      <View style={styles.subagent}>
        <SubagentCard id={row.call.subagent} />
      </View>
    );
  }
  if (row.kind === "tool") {
    const { call, result } = row;
    const dot = !result ? statusColors.working : result.ok ? statusColors.done : colors.danger;
    return (
      <View style={styles.tool}>
        <Expandable
          title={
            <View style={styles.toolTitle}>
              <View style={[styles.toolDot, { backgroundColor: dot }]} />
              <Text style={styles.toolName}>{call.name}</Text>
              <Text style={styles.toolSummary} numberOfLines={1}>
                {call.summary}
              </Text>
              {call.diff ? <Counts additions={call.diff.additions} deletions={call.diff.deletions} /> : null}
            </View>
          }
        >
          {call.diff ? (
            // Exactly what this edit changed; its output only matters if it failed.
            <>
              <DiffView diff={call.diff} compact />
              {result && !result.ok ? <Output text={result.output} /> : null}
            </>
          ) : (
            <>
              {call.input ? <Output text={call.input} /> : null}
              {result ? <Output text={result.output} /> : <Text style={styles.muted}>Running…</Text>}
            </>
          )}
        </Expandable>
        {result?.images?.length ? <ConversationImages images={result.images} /> : null}
      </View>
    );
  }
  if (row.kind === "group") {
    const groupImages = rowImages(row);
    return (
      <View style={styles.tool}>
        <Expandable
          title={
            <View style={styles.toolTitle}>
              <View style={[styles.toolDot, { backgroundColor: row.failed ? colors.danger : statusColors.done }]} />
              <Text style={styles.toolName}>{row.tools} tool calls</Text>
              <Text style={styles.toolSummary} numberOfLines={1}>
                {row.names.map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(" · ")}
              </Text>
            </View>
          }
        >
          {row.rows.map((inner) => (
            <RowView key={inner.key} row={inner} />
          ))}
        </Expandable>
        {groupImages.length ? <ConversationImages images={groupImages} /> : null}
      </View>
    );
  }
  if (row.kind === "queued") {
    return (
      <View style={styles.userRow}>
        <View style={[styles.userBubble, styles.queuedBubble]}>
          <Text style={[styles.userText, styles.queuedText]} selectable>
            {row.message.text}
          </Text>
        </View>
        <View style={styles.queuedLabel}>
          <Clock size={11} color={colors.subtle} />
          <Text style={styles.queuedLabelText}>Queued</Text>
        </View>
      </View>
    );
  }
  if (row.kind === "orphan_result") {
    return (
      <View style={styles.tool}>
        <Expandable title={<Text style={styles.toolSummary}>Tool output</Text>}>
          <Output text={row.result.output} />
        </Expandable>
        {row.result.images?.length ? <ConversationImages images={row.result.images} /> : null}
      </View>
    );
  }
  const { entry } = row;
  switch (entry.kind) {
    case "user": {
      // With the images themselves below, drop the "[image]" stand-ins from the text.
      const text = entry.images?.length ? entry.text.replace(/\[image\]\s*/g, "").trim() : entry.text;
      return (
        <View style={styles.userRow}>
          {text ? (
            <View style={styles.userBubble}>
              <Text style={styles.userText} selectable>
                {text}
              </Text>
            </View>
          ) : null}
          {entry.images?.length ? <ConversationImages images={entry.images} align="end" /> : null}
        </View>
      );
    }
    case "assistant":
      return (
        <View style={styles.assistant}>
          <Markdown text={entry.text} />
        </View>
      );
    case "thinking":
      return (
        <View style={styles.tool}>
          <Expandable title={<Text style={styles.thinkingTitle}>Thinking</Text>}>
            <Text style={styles.thinking} selectable>
              {entry.text}
            </Text>
          </Expandable>
        </View>
      );
    case "notice":
      return <Text style={styles.notice}>{entry.text}</Text>;
  }
});

const native = Platform.OS !== "web";

/** "Jump to the latest": pops up with a little bounce when you scroll away from the bottom, and shrinks away when you're back. */
function ToBottom({ visible, onPress }: { visible: boolean; onPress: () => void }) {
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
        styles.toBottomPlace,
        {
          opacity: shown.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1], extrapolate: "clamp" }),
          transform: [
            { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
            { scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
          ],
        },
      ]}
    >
      <PressableScale onPress={onPress} style={styles.toBottom} accessibilityLabel="Jump to the latest">
        <ArrowDown size={18} color={colors.text} />
      </PressableScale>
    </Animated.View>
  );
}

export type ConversationHandle = { scrollToBottom: () => void };

/** A row counts as on screen when a third of it shows. */
const VIEWABILITY = { itemVisiblePercentThreshold: 30 };

type Props = {
  entries: ConversationEntry[];
  /** Messages waiting in the agent's own queue. */
  queued: QueuedMessage[];
  /** null while the first page is loading. */
  ready: boolean;
  working: boolean;
  /** What the agent's screen says it's doing right now, e.g. "Baking… · 5m 20s". */
  activity?: string | null;
  atStart: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
};

/** An agent's conversation as native, smoothly scrolling messages, newest at the bottom. */
export const Conversation = forwardRef<ConversationHandle, Props>(function Conversation(
  { entries, queued, ready, working, activity, atStart, loadingOlder, onLoadOlder },
  ref,
) {
  const list = useRef<FlatList<Row>>(null);
  const [scrolledUp, setScrolledUp] = useState(false);
  const offset = useRef(0);
  // Opening a row: keep its title in place and let it unfold downwards (see GrowContext).
  const keepTitleInPlace = useCallback((delta: number) => {
    offset.current = Math.max(0, offset.current + delta);
    list.current?.scrollToOffset({ offset: offset.current, animated: false });
  }, []);
  // Inverted: the newest row is first, at the bottom of the screen; queued messages below that.
  const rows = useMemo(() => [...queuedRows(queued), ...groupActivity(conversationRows(entries)).reverse()], [entries, queued]);
  const userMessages = useMemo(() => countUserMessages(rows), [rows]);
  const showJumps = userMessages > 1 || scrolledUp;

  // Which rows are on screen, for the jump arrows.
  const visible = useRef({ newest: 0, oldest: 0 });
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<Row>[] }) => {
    const indexes = viewableItems.map((v) => v.index).filter((i): i is number => i !== null);
    if (indexes.length) visible.current = { newest: Math.min(...indexes), oldest: Math.max(...indexes) };
  }, []);

  // Where the arrows last went: pressing again continues from there, even before
  // Android has reported what's on screen after the jump. Scrolling by hand resets it.
  const lastJump = useRef<number | null>(null);
  const retries = useRef(0);
  const scrollTo = useCallback((index: number) => {
    lastJump.current = index;
    retries.current = 0;
    // viewPosition 1 is the top of the screen in an inverted list: the message, then what followed it.
    list.current?.scrollToIndex({ index, animated: true, viewPosition: 1 });
  }, []);
  /** What the arrows count from: what's on screen, or where they last went. */
  const position = () => {
    const seen = visible.current;
    const jumped = lastJump.current;
    return jumped === null ? seen : { newest: Math.min(seen.newest, jumped), oldest: Math.max(seen.oldest, jumped) };
  };
  // Going back to a message that isn't loaded yet: load older pages until it is.
  const seekingOlder = useRef(false);
  useEffect(() => {
    if (!seekingOlder.current || loadingOlder) return;
    const index = userMessageIndex(rows, position(), "older");
    if (index !== null || atStart) seekingOlder.current = false;
    if (index !== null) scrollTo(index);
    else if (!atStart) onLoadOlder();
  }, [loadingOlder, rows, atStart, onLoadOlder, scrollTo]);

  const jump = (direction: "older" | "newer") => {
    const from = position();
    const index = userMessageIndex(rows, direction === "newer" && lastJump.current !== null ? { newest: lastJump.current, oldest: lastJump.current } : from, direction);
    if (index !== null) scrollTo(index);
    else if (direction === "newer") {
      lastJump.current = null;
      list.current?.scrollToOffset({ offset: 0, animated: true });
    }
    else if (!atStart) {
      seekingOlder.current = true;
      onLoadOlder();
    }
  };
  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: () => list.current?.scrollToOffset({ offset: 0, animated: true }),
    }),
    [],
  );

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }
  return (
    <View style={styles.container}>
      <GrowContext.Provider value={keepTitleInPlace}>
        <FlatList
          ref={list}
          inverted
          data={rows}
          keyExtractor={(r) => r.key}
          renderItem={({ item }) => <RowView row={item} />}
          contentContainerStyle={styles.content}
          onEndReached={atStart ? undefined : onLoadOlder}
          onEndReachedThreshold={0.6}
          onScroll={(e) => {
            offset.current = e.nativeEvent.contentOffset.y;
            setScrolledUp(e.nativeEvent.contentOffset.y > 240);
          }}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY}
          onScrollToIndexFailed={(info) => {
            // The row isn't drawn yet: get close (rows differ in height), let the list draw
            // around there, and try again, a few times if need be.
            if (retries.current++ > 12) return;
            list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 1 }), 120);
          }}
          onScrollBeginDrag={() => (lastJump.current = null)}
          windowSize={31}
          maxToRenderPerBatch={30}
          scrollEventThrottle={100}
          ListHeaderComponent={
            // The newest end of the list: keep it clear of the jump arrows.
            <View>
              {working ? (
                <Text style={styles.working} numberOfLines={1}>
                  {activity ?? "Working…"}
                </Text>
              ) : null}
              {showJumps ? <View style={styles.jumpsSpace} /> : null}
            </View>
          }
          ListFooterComponent={
            loadingOlder ? (
              <ActivityIndicator style={styles.older} color={colors.subtle} />
            ) : atStart && rows.length > 0 ? (
              <Text style={styles.notice}>Start of the conversation</Text>
            ) : null
          }
          ListEmptyComponent={<Text style={[styles.notice, styles.flipped]}>No messages yet.</Text>}
          keyboardShouldPersistTaps="handled"
        />
      </GrowContext.Provider>
      <ToBottom visible={scrolledUp} onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })} />
      {showJumps ? (
        <View style={styles.jumps}>
          <PressableScale onPress={() => jump("older")} style={styles.jump} accessibilityLabel="Your previous message">
            {loadingOlder ? <ActivityIndicator size="small" color={colors.muted} /> : <ChevronUp size={18} color={colors.text} />}
          </PressableScale>
          <View style={styles.jumpDivider} />
          <PressableScale onPress={() => jump("newer")} style={styles.jump} accessibilityLabel="Your next message">
            <ChevronDown size={18} color={colors.text} />
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
});

const styles = themed(() =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: space.md,
      paddingVertical: space.md,
      gap: space.md,
    },
    flipped: { transform: [{ scaleY: -1 }] },
    userRow: { alignItems: "flex-end" },
    userBubble: {
      maxWidth: "88%",
      backgroundColor: colors.raised,
      borderRadius: 18,
      borderBottomRightRadius: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    userText: { fontSize: 15, lineHeight: 21, color: colors.text },
    assistant: { paddingRight: space.sm },
    codeBlock: {
      backgroundColor: colors.terminal,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      maxHeight: 360,
    },
    codeBlockInner: { padding: space.md },
    code: {
      fontFamily: fonts.mono,
      fontSize: 12.5,
      lineHeight: 18,
      color: colors.terminalText,
    },
    tool: { marginVertical: -2 },
    subagent: { marginVertical: 2 },
    expandHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 4,
    },
    expandBody: { gap: space.sm, paddingTop: 4, paddingLeft: 20 },
    toolTitle: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
    toolDot: { width: 7, height: 7, borderRadius: 4 },
    toolName: { fontFamily: fonts.mono, fontSize: 13, color: colors.text },
    toolSummary: {
      fontFamily: fonts.mono,
      fontSize: 13,
      color: colors.muted,
      flexShrink: 1,
    },
    thinkingTitle: {
      fontSize: 13.5,
      color: colors.subtle,
      fontStyle: "italic",
    },
    thinking: {
      fontSize: 13.5,
      lineHeight: 19,
      color: colors.muted,
      fontStyle: "italic",
    },
    muted: { fontSize: 13, color: colors.muted },
    notice: {
      fontSize: 12,
      color: colors.subtle,
      textAlign: "center",
      paddingVertical: space.xs,
    },
    working: {
      fontSize: 13,
      color: statusColors.working,
      paddingVertical: space.xs,
    },
    older: { paddingVertical: space.md },
    queuedBubble: { backgroundColor: "transparent", borderWidth: 1, borderStyle: "dashed", borderColor: colors.border },
    queuedText: { color: colors.muted },
    queuedLabel: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4, marginRight: 4 },
    queuedLabelText: { fontSize: 11, color: colors.subtle },
    jumps: {
      position: "absolute",
      right: 12,
      bottom: 12,
      borderRadius: 20,
      backgroundColor: colors.floating,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.edge,
      overflow: "hidden",
    },
    jump: { width: 40, height: 38, alignItems: "center", justifyContent: "center" },
    jumpsSpace: { height: 72 },
    jumpDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.edge, marginHorizontal: 8 },
    toBottomPlace: { position: "absolute", bottom: 12, alignSelf: "center" },
    toBottom: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.floating,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.edge,
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
