import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBadge } from "../../components/StatusBadge";
import { TerminalView, type TerminalViewHandle, type TerminalViewMode } from "../../components/TerminalView";
import type { TerminalHandle } from "../../lib/host-client";
import { agentName, shortPath } from "../../lib/agents";
import { useConnection, useHostState } from "../../lib/connection";
import { usePalette } from "../../theme";

const REOPEN_MS = 1500;
const MONO = Platform.select({ android: "monospace", default: "Menlo" });

/** Keys for answering agent prompts; values are herdr key-combo names. */
const QUICK_KEYS: { label: string; keys: string[]; confirm?: string }[] = [
  { label: "Enter", keys: ["enter"] },
  { label: "Esc", keys: ["esc"] },
  { label: "↑", keys: ["up"] },
  { label: "↓", keys: ["down"] },
  { label: "Tab", keys: ["tab"] },
  { label: "1", keys: ["1"] },
  { label: "2", keys: ["2"] },
  { label: "3", keys: ["3"] },
  { label: "y", keys: ["y"] },
  { label: "n", keys: ["n"] },
  { label: "Ctrl-C", keys: ["ctrl+c"], confirm: "Send Ctrl-C to this agent?" },
];

export default function AgentScreen() {
  const { paneId } = useLocalSearchParams<{ paneId: string }>();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { client } = useConnection();
  const state = useHostState();
  const agent = state.agents.find((a) => a.pane_id === paneId) ?? null;

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [viewMode, setViewMode] = useState<TerminalViewMode>("native");
  const [ready, setReady] = useState(false);
  const [fitSize, setFitSize] = useState<{ cols: number; rows: number } | null>(null);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const terminal = useRef<TerminalViewHandle>(null);
  const stream = useRef<TerminalHandle | null>(null);
  const online = state.status === "online";

  useEffect(() => {
    if (ready) terminal.current?.setMode(viewMode);
  }, [ready, viewMode]);

  // (Re)open the stream whenever the view, size or connection changes.
  const fitCols = fitSize?.cols;
  const fitRows = fitSize?.rows;
  useEffect(() => {
    if (!client || !paneId || !ready || !online) return;
    if (viewMode === "fit" && (!fitCols || !fitRows)) return;

    terminal.current?.reset();
    let reopen: ReturnType<typeof setTimeout> | null = null;
    const handle = client.openTerminal(
      paneId,
      viewMode === "fit" ? { mode: "control", cols: fitCols, rows: fitRows } : { mode: "observe" },
      {
        onFrame: (frame) => {
          setClosedReason(null);
          terminal.current?.write(frame);
        },
        onClosed: (reason) => {
          stream.current = null;
          setClosedReason(reason);
          if (reason !== "disconnected") reopen = setTimeout(() => setEpoch((e) => e + 1), REOPEN_MS);
        },
      },
    );
    stream.current = handle;
    return () => {
      if (reopen) clearTimeout(reopen);
      handle?.close();
      stream.current = null;
    };
  }, [client, paneId, ready, online, viewMode, fitCols, fitRows, epoch]);

  const sendKeys = async (keys: string[], confirm?: string) => {
    if (!client || !paneId) return;
    const go = async () => {
      try {
        await client.call("agent.send_keys", { target: paneId, keys });
      } catch (err) {
        Alert.alert("Couldn't send keys", (err as Error).message);
      }
    };
    if (confirm) Alert.alert(confirm, undefined, [{ text: "Cancel", style: "cancel" }, { text: "Send", onPress: go }]);
    else await go();
  };

  const sendPrompt = async () => {
    const text = draft.trim();
    if (!client || !paneId || !text) return;
    setSending(true);
    try {
      await client.call("agent.prompt", { target: paneId, text });
      setDraft("");
    } catch (err) {
      Alert.alert("Couldn't send prompt", (err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={80}>
      <Stack.Screen options={{ title: agent ? agentName(agent) : paneId }} />

      <View style={[styles.header, { borderColor: palette.border, backgroundColor: palette.surface }]}>
        <Text style={{ color: palette.muted, flexShrink: 1 }} numberOfLines={1}>
          {paneId}
          {agent ? `  ·  ${shortPath(agent.foreground_cwd ?? agent.cwd) ?? ""}` : "  ·  gone"}
        </Text>
        <View style={styles.headerRight}>
          {agent ? <StatusBadge status={agent.agent_status} /> : null}
          <Pressable
            onPress={() => setViewMode((m) => (m === "native" ? "fit" : "native"))}
            style={[styles.toggle, { borderColor: palette.border }]}
            hitSlop={8}
          >
            <Text style={{ color: palette.accent, fontSize: 12, fontWeight: "600" }}>
              {viewMode === "native" ? "Fit to phone" : "Full width"}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1, backgroundColor: palette.terminal }}>
        <TerminalView
          ref={terminal}
          onReady={() => setReady(true)}
          onFitSize={(cols, rows) => setFitSize((prev) => (prev?.cols === cols && prev.rows === rows ? prev : { cols, rows }))}
          onInput={(data) => stream.current?.input(data)}
        />
        {closedReason && closedReason !== "closed by client" ? (
          <Text style={[styles.notice, { color: palette.muted }]}>Terminal closed: {closedReason}</Text>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.keysBar, { borderColor: palette.border, backgroundColor: palette.surface }]}
        contentContainerStyle={styles.keys}
        keyboardShouldPersistTaps="handled"
      >
        {QUICK_KEYS.map((k) => (
          <Pressable
            key={k.label}
            onPress={() => sendKeys(k.keys, k.confirm)}
            style={({ pressed }) => [styles.key, { borderColor: palette.border, opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={{ color: palette.text, fontFamily: MONO }}>{k.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: 8 + insets.bottom, backgroundColor: palette.surface }]}>
        <TextInput
          style={[styles.input, { color: palette.text, borderColor: palette.border }]}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message this agent"
          placeholderTextColor={palette.muted}
          multiline
        />
        <Pressable
          onPress={sendPrompt}
          disabled={sending || !draft.trim()}
          style={[styles.send, { backgroundColor: palette.accent, opacity: sending || !draft.trim() ? 0.5 : 1 }]}
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  toggle: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  notice: { position: "absolute", bottom: 8, left: 8, right: 8, fontSize: 12, textAlign: "center" },
  keysBar: { flexGrow: 0, borderTopWidth: 1 },
  keys: { gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
  key: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 8, paddingTop: 8 },
  input: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, maxHeight: 120, fontSize: 15 },
  send: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  sendText: { color: "#FFFFFF", fontWeight: "600" },
});
