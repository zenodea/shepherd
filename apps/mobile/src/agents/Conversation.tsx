import { ArrowDown, ChevronRight } from "lucide-react-native";
import { forwardRef, memo, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ConversationEntry } from "@shepherd/protocol";
import { PressableScale } from "../ui/Pressable";
import { colors, fonts, space, statusColors, themed } from "../ui/theme";
import { conversationRows, markdownBlocks, type Row } from "./conversation-rows";

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
            </View>
          }
        >
          {call.input ? <Output text={call.input} /> : null}
          {result ? <Output text={result.output} /> : <Text style={styles.muted}>Running…</Text>}
        </Expandable>
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

type Props = {
  entries: ConversationEntry[];
  /** null while the first page is loading. */
  ready: boolean;
  working: boolean;
  atStart: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
};

/** An agent's conversation as native, smoothly scrolling messages, newest at the bottom. */
export const Conversation = forwardRef<ConversationHandle, Props>(function Conversation(
  { entries, ready, working, atStart, loadingOlder, onLoadOlder },
  ref,
) {
  const list = useRef<FlatList<Row>>(null);
  const [scrolledUp, setScrolledUp] = useState(false);
  // Inverted: the newest row is first, at the bottom of the screen.
  const rows = useMemo(() => conversationRows(entries).reverse(), [entries]);
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
        scrollEventThrottle={100}
        ListHeaderComponent={working ? <Text style={styles.working}>Working…</Text> : null}
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
