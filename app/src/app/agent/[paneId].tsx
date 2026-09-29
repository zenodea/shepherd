import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PaneReadResult } from "@sheperd/protocol";
import { StatusBadge } from "../../components/StatusBadge";
import { agentName, shortPath } from "../../lib/agents";
import { useConnection, useHostState } from "../../lib/connection";
import { usePalette } from "../../theme";

const POLL_MS = 2000;
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

  const [output, setOutput] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const read = useCallback(async () => {
    if (!client || !paneId) return;
    try {
      const { read } = await client.call<{ read: PaneReadResult }>("agent.read", {
        target: paneId,
        source: "recent",
        lines: 200,
        format: "text",
      });
      setOutput(read.text.replace(/\s+$/, ""));
    } catch {
      // keep the last output; the list screen shows connection state
    }
  }, [client, paneId]);

  // Poll while this screen is focused; the live terminal view will replace this.
  useFocusEffect(
    useCallback(() => {
      void read();
      const timer = setInterval(read, POLL_MS);
      return () => clearInterval(timer);
    }, [read]),
  );

  useEffect(() => {
    if (!client) return;
    return client.onStatusChange((change) => {
      if (change.paneId === paneId) void read();
    });
  }, [client, paneId, read]);

  const sendKeys = async (keys: string[], confirm?: string) => {
    if (!client || !paneId) return;
    const go = async () => {
      try {
        await client.call("agent.send_keys", { target: paneId, keys });
        setTimeout(read, 300);
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
      setTimeout(read, 300);
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
        {agent ? <StatusBadge status={agent.agent_status} /> : null}
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: palette.terminal }}
        contentContainerStyle={{ padding: 10 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        <Text selectable style={[styles.output, { color: palette.terminalText }]}>
          {output || "…"}
        </Text>
      </ScrollView>

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
  output: { fontFamily: MONO, fontSize: 12, lineHeight: 16 },
  keysBar: { flexGrow: 0, borderTopWidth: 1 },
  keys: { gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
  key: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 8, paddingTop: 8 },
  input: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, maxHeight: 120, fontSize: 15 },
  send: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  sendText: { color: "#FFFFFF", fontWeight: "600" },
});
