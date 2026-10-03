import { ArrowDown, ChevronDown, ChevronRight, ChevronUp, Clock } from "lucide-react-native";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View, type ViewToken } from "react-native";
import type { ConversationEntry, QueuedMessage } from "@shepherd/protocol";
import { PressableScale } from "../ui/Pressable";
import { Counts } from "./Counts";
import { DiffView } from "./DiffView";
import { colors, fonts, space, statusColors, themed } from "../ui/theme";
import { conversationRows, countUserMessages, groupActivity, markdownBlocks, queuedRows, userMessageIndex, type Row } from "./conversation-rows";

/** Inline `code`, **bold** and # headings in a line of prose. */
function Inline({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <Text style={styles.prose} selectable>
      {lines.map((line, li) => {
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        const content = heading ? heading[1]! : line;
        const parts = content.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
        return (
          <Text key={li} style={heading ? styles.heading : undefined}>
            {li > 0 ? "\n" : ""}
            {parts.map((part, pi) =>
              part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
                <Text key={pi} style={styles.inlineCode}>
                  {part.slice(1, -1)}
                </Text>
              ) : part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
                <Text key={pi} style={styles.bold}>
                  {part.slice(2, -2)}
                </Text>
              ) : (
                part
              ),
            )}
          </Text>
        );
      })}
    </Text>
  );
}

function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => markdownBlocks(text), [text]);
  return (
    <View style={styles.markdown}>
      {blocks.map((b, i) =>
        b.code ? (
          <ScrollView key={i} horizontal style={styles.codeBlock} contentContainerStyle={styles.codeBlockInner}>
            <Text style={styles.code} selectable>
              {b.text}
            </Text>
          </ScrollView>
        ) : (
          <Inline key={i} text={b.text} />
        ),
      )}
    </View>
  );
}

function Expandable({ title, children, defaultOpen = false }: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View>
      <PressableScale onPress={() => setOpen((o) => !o)} style={styles.expandHead} accessibilityRole="button" accessibilityState={{ expanded: open }}>
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
      </View>
    );
  }
  if (row.kind === "group") {
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
      </View>
    );
  }
  const { entry } = row;
  switch (entry.kind) {
    case "user":
      return (
        <View style={styles.userRow}>
          <View style={styles.userBubble}>
            <Text style={styles.userText} selectable>
              {entry.text}
            </Text>
          </View>
        </View>
      );
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
  atStart: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
};

/** An agent's conversation as native, smoothly scrolling messages, newest at the bottom. */
export const Conversation = forwardRef<ConversationHandle, Props>(function Conversation(
  { entries, queued, ready, working, atStart, loadingOlder, onLoadOlder },
  ref,
) {
  const list = useRef<FlatList<Row>>(null);
  const [scrolledUp, setScrolledUp] = useState(false);
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

  const scrollTo = useCallback((index: number) => {
    // viewPosition 1 is the top of the screen in an inverted list: the message, then what followed it.
    list.current?.scrollToIndex({ index, animated: true, viewPosition: 1 });
  }, []);
  // Going back to a message that isn't loaded yet: load older pages until it is.
  const seekingOlder = useRef(false);
  useEffect(() => {
    if (!seekingOlder.current || loadingOlder) return;
    const index = userMessageIndex(rows, visible.current, "older");
    if (index !== null || atStart) seekingOlder.current = false;
    if (index !== null) scrollTo(index);
    else if (!atStart) onLoadOlder();
  }, [loadingOlder, rows, atStart, onLoadOlder, scrollTo]);

  const jump = (direction: "older" | "newer") => {
    const index = userMessageIndex(rows, visible.current, direction);
    if (index !== null) scrollTo(index);
    else if (direction === "newer") list.current?.scrollToOffset({ offset: 0, animated: true });
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
      <FlatList
        ref={list}
        inverted
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={({ item }) => <RowView row={item} />}
        contentContainerStyle={styles.content}
        onEndReached={atStart ? undefined : onLoadOlder}
        onEndReachedThreshold={0.6}
        onScroll={(e) => setScrolledUp(e.nativeEvent.contentOffset.y > 240)}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={VIEWABILITY}
        onScrollToIndexFailed={(info) => {
          // Rows have different heights: get close, then try again once they've been measured.
          list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 1 }), 80);
        }}
        scrollEventThrottle={100}
        ListHeaderComponent={
          // The newest end of the list: keep it clear of the jump arrows.
          <View>
            {working ? <Text style={styles.working}>Working…</Text> : null}
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
      {scrolledUp ? (
        <PressableScale
          onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
          style={styles.toBottom}
          accessibilityLabel="Jump to the latest"
        >
          <ArrowDown size={18} color={colors.text} />
        </PressableScale>
      ) : null}
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
    markdown: { gap: space.sm },
    prose: { fontSize: 15, lineHeight: 22, color: colors.text },
    heading: { fontWeight: "700" },
    bold: { fontWeight: "700" },
    inlineCode: {
      fontFamily: fonts.mono,
      fontSize: 13.5,
      color: colors.text,
      backgroundColor: colors.raised,
    },
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
    toBottom: {
      position: "absolute",
      bottom: 12,
      alignSelf: "center",
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
