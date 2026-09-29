import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowDown, ArrowUp, ChevronLeft, Maximize2, Minimize2, Sparkles, SquareTerminal } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TERMINAL_KIND, type PaneReadResult, type StartAgentResult } from "@sheperd/protocol";
import { agentName, agentTitle, projectOf } from "../../agents/agents";
import { PromptChips } from "../../agents/PromptCard";
import { useBlockedPrompts } from "../../agents/use-blocked-prompts";
import { useWorkspaceTabs } from "../../agents/use-workspace-tabs";
import { WorkspaceTabs } from "../../agents/WorkspaceTabs";
import { useConnection, useHostState } from "../../connection/connection";
import type { TerminalHandle } from "../../connection/host-client";
import { loadPref, savePref } from "../../connection/prefs";
import { textToBase64 } from "../../terminal/encoding";
import { TerminalView, type TerminalViewHandle, type TerminalViewMode } from "../../terminal/TerminalView";
import { ActionSheet } from "../../ui/ActionSheet";
import { IconButton } from "../../ui/IconButton";
import { PressableScale } from "../../ui/Pressable";
import { Banner, Screen } from "../../ui/Screen";
import { StatusIndicator } from "../../ui/StatusIndicator";
import { colors, fonts, space, statusColors, statusLabels } from "../../ui/theme";

const REOPEN_MS = 1500;
const HISTORY_LINES = 2000;

/** Quick keys (herdr key names), grouped like Superset's bar. */
const QUICK_KEYS: { label: string; keys: string[]; confirm?: string }[][] = [
  [
    { label: "esc", keys: ["esc"] },
    { label: "↵", keys: ["enter"] },
    { label: "tab", keys: ["tab"] },
    { label: "⇧tab", keys: ["shift+tab"] },
  ],
  [
    { label: "↑", keys: ["up"] },
    { label: "↓", keys: ["down"] },
    { label: "←", keys: ["left"] },
    { label: "→", keys: ["right"] },
  ],
  [{ label: "^C", keys: ["ctrl+c"], confirm: "Send Ctrl-C?" }],
];

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

export default function TerminalScreen() {
  const { paneId } = useLocalSearchParams<{ paneId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const { client } = useConnection();
  const state = useHostState();
  const agent = state.agents.find((a) => a.pane_id === paneId) ?? null;
  const workspaceId = agent?.workspace_id ?? paneId?.split(":")[0] ?? null;
  const { tabs, panes } = useWorkspaceTabs(client, workspaceId, state.agents);
  const pane = panes.find((p) => p.pane_id === paneId) ?? null;
  const agentsForPrompt = useMemo(() => (agent ? [agent] : []), [agent]);
  const prompt = useBlockedPrompts(client, agentsForPrompt)[paneId ?? ""];

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [viewMode, setViewMode] = useState<TerminalViewMode>("fit");
  const [ready, setReady] = useState(false);
  const [fitSize, setFitSize] = useState<{ cols: number; rows: number } | null>(null);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const [newSheet, setNewSheet] = useState(false);
  const terminal = useRef<TerminalViewHandle>(null);
  // Fit mode: how far back herdr's view is scrolled, in lines (0 = live).
  const scrollOffset = useRef(0);
  const stream = useRef<TerminalHandle | null>(null);
  const online = state.status === "online";

  // Remember full width vs fit to phone.
  useEffect(() => {
    void loadPref("viewMode").then((v) => {
      if (v === "native" || v === "fit") setViewMode(v);
    });
  }, []);
  const toggleMode = () => {
    const next = viewMode === "native" ? "fit" : "native";
    setViewMode(next);
    void savePref("viewMode", next);
  };

  useEffect(() => {
    if (ready) terminal.current?.setMode(viewMode);
  }, [ready, viewMode]);

  // Load the scrollback, then stream the live screen. Re-runs when the pane,
  // view, size or connection changes.
  const fitCols = fitSize?.cols;
  const fitRows = fitSize?.rows;
  useEffect(() => {
    if (!client || !paneId || !ready || !online) return;
    if (viewMode === "fit" && (!fitCols || !fitRows)) return;

    let cancelled = false;
    let handle: TerminalHandle | null = null;
    let reopen: ReturnType<typeof setTimeout> | null = null;
    terminal.current?.reset();
    scrollOffset.current = 0;

    void (async () => {
      setAtBottom(true);
      // Full width only observes, so load the scrollback to scroll through
      // locally. In fit mode herdr scrolls the pane itself.
      if (viewMode === "native") {
        try {
          const { read } = await client.call<{ read: PaneReadResult }>("pane.read", {
            pane_id: paneId,
            source: "recent_unwrapped",
            format: "ansi",
            lines: HISTORY_LINES,
          });
          if (!cancelled && read.text) terminal.current?.writeHistory(textToBase64(read.text.replace(/\r?\n/g, "\r\n") + "\r\n"));
        } catch {
          // history is a nice-to-have
        }
      }
      if (cancelled) return;
      handle = client.openTerminal(
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
    })();

    return () => {
      cancelled = true;
      if (reopen) clearTimeout(reopen);
      handle?.close();
      stream.current = null;
    };
  }, [client, paneId, ready, online, viewMode, fitCols, fitRows, epoch]);

  const openTerminal = async () => {
    if (!client || !workspaceId) return;
    try {
      const result = await client.call<StartAgentResult>("sheperd.start_agent", { kind: TERMINAL_KIND, workspaceId });
      router.setParams({ paneId: result.paneId });
    } catch (err) {
      Alert.alert("Couldn't open a terminal", (err as Error).message);
    }
  };

  const onWheel = (lines: number) => {
    const handle = stream.current;
    if (!handle) return;
    const next = Math.max(0, scrollOffset.current + lines);
    const delta = next - scrollOffset.current;
    scrollOffset.current = next;
    if (delta > 0) handle.scroll("up", delta);
    else if (delta < 0) handle.scroll("down", -delta);
    setAtBottom(next === 0);
  };

  const toLive = () => {
    if (viewMode === "fit" && scrollOffset.current > 0) {
      stream.current?.scroll("down", scrollOffset.current + 5);
      scrollOffset.current = 0;
      setAtBottom(true);
    } else {
      terminal.current?.scrollToBottom();
    }
  };

  const sendKeys = async (keys: string[], confirm?: string) => {
    if (!client || !paneId) return;
    const go = async () => {
      try {
        await client.call("pane.send_keys", { pane_id: paneId, keys });
        toLive();
      } catch (err) {
        Alert.alert("Couldn't send keys", (err as Error).message);
      }
    };
    if (confirm) Alert.alert(confirm, undefined, [{ text: "Cancel", style: "cancel" }, { text: "Send", onPress: go }]);
    else await go();
  };

  const submit = async () => {
    const text = draft.trim();
    if (!client || !paneId || !text) return;
    setSending(true);
    try {
      if (agent) await client.call("agent.prompt", { target: paneId, text });
      else await client.call("pane.send_input", { pane_id: paneId, text, keys: ["enter"] });
      setDraft("");
      toLive();
    } catch (err) {
      Alert.alert("Couldn't send", (err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const title = agent ? (agentTitle(agent) ?? agentName(agent)) : (pane?.terminal_title_stripped ?? pane?.title ?? "Terminal");
  const canSend = draft.trim().length > 0 && !sending;

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
          <ChevronLeft size={22} color={colors.text} />
        </IconButton>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.subline}>
            {agent ? <StatusIndicator status={agent.agent_status} size={7} /> : null}
            <Text style={styles.sublineText} numberOfLines={1}>
              {agent ? (
                <>
                  <Text style={{ color: agent.agent_status === "idle" ? colors.subtle : statusColors[agent.agent_status] }}>
                    {statusLabels[agent.agent_status]}
                  </Text>
                  {`  ·  ${agentName(agent)}  ·  ${projectOf(agent)}`}
                </>
              ) : (
                `Shell  ·  ${pane?.cwd?.split("/").filter(Boolean).pop() ?? paneId}`
              )}
            </Text>
          </View>
        </View>
        <IconButton label={viewMode === "native" ? "Fit to phone" : "Full width"} onPress={toggleMode}>
          {viewMode === "native" ? <Maximize2 size={17} color={colors.text} /> : <Minimize2 size={17} color={colors.text} />}
        </IconButton>
      </View>

      {!online ? <Banner>{state.status === "connecting" ? "Connecting…" : "Can't reach your computer. Retrying…"}</Banner> : null}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={styles.terminal}>
          <TerminalView
            ref={terminal}
            onReady={() => setReady(true)}
            onFitSize={(cols, rows) => setFitSize((prev) => (prev?.cols === cols && prev.rows === rows ? prev : { cols, rows }))}
            onTap={() => Keyboard.dismiss()}
            onScrollChange={(bottom) => viewMode === "native" && setAtBottom(bottom)}
            onWheel={onWheel}
          />
          {!atBottom ? (
            <PressableScale onPress={toLive} style={styles.toBottom} accessibilityLabel="Back to live">
              <ArrowDown size={18} color={colors.text} />
            </PressableScale>
          ) : null}
          {closedReason && closedReason !== "closed by client" && closedReason !== "disconnected" ? (
            <Text style={styles.notice}>Terminal closed: {closedReason}</Text>
          ) : null}
        </View>

        <View style={[styles.bottom, { paddingBottom: keyboardVisible ? space.sm : Math.max(insets.bottom, space.sm) }]}>
          {agent?.agent_status === "blocked" && prompt ? <PromptChips key={JSON.stringify(prompt)} client={client} paneId={paneId!} prompt={prompt} /> : null}

          <WorkspaceTabs
            tabs={tabs}
            activePaneId={paneId!}
            onSelect={(tab) => {
              if (tab.paneId === paneId) return;
              setClosedReason(null);
              router.setParams({ paneId: tab.paneId });
            }}
            onNew={() => setNewSheet(true)}
          />

          <View style={styles.keys}>
            {QUICK_KEYS.map((group, gi) => (
              <View key={gi} style={[styles.keyGroup, gi > 0 && styles.keyGroupDivider]}>
                {group.map((k) => (
                  <PressableScale key={k.label} onPress={() => sendKeys(k.keys, k.confirm)} style={styles.key}>
                    <Text style={styles.keyLabel}>{k.label}</Text>
                  </PressableScale>
                ))}
              </View>
            ))}
          </View>

          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a message…"
              placeholderTextColor={colors.subtle}
              multiline
              numberOfLines={1}
            />
            {canSend || sending ? (
              <PressableScale onPress={submit} disabled={!canSend} style={styles.send} accessibilityLabel="Send">
                <ArrowUp size={18} color={colors.onPrimary} strokeWidth={2.5} />
              </PressableScale>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>

      <ActionSheet
        visible={newSheet}
        title={`New in ${agent ? projectOf(agent) : "this workspace"}`}
        onClose={() => setNewSheet(false)}
        actions={[
          {
            icon: <SquareTerminal size={19} color={colors.text} />,
            title: "Terminal",
            detail: "A new shell tab, opened right away",
            onPress: () => void openTerminal(),
          },
          {
            icon: <Sparkles size={19} color={colors.text} />,
            title: "Agent…",
            detail: "Claude, Codex or another agent, with a first message",
            onPress: () => router.push({ pathname: "/new", params: workspaceId ? { workspace: workspaceId } : {} }),
          },
        ]}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  headerText: { flex: 1, gap: 3 },
  title: { fontSize: 16, fontWeight: "600", color: colors.text },
  subline: { flexDirection: "row", alignItems: "center", gap: 7 },
  sublineText: { fontSize: 12.5, color: colors.muted, flexShrink: 1 },
  terminal: { flex: 1, backgroundColor: colors.terminal },
  toBottom: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(38,38,38,0.95)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  notice: { position: "absolute", bottom: 10, left: 12, right: 12, textAlign: "center", fontSize: 12, color: colors.muted },
  bottom: { backgroundColor: colors.background, gap: 8, paddingTop: 8 },
  keys: {
    flexDirection: "row",
    alignSelf: "stretch",
    marginHorizontal: 12,
    backgroundColor: colors.raised,
    borderRadius: 11,
    height: 36,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  keyGroup: { flexDirection: "row", alignItems: "center", flexGrow: 1, justifyContent: "space-around" },
  keyGroupDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.14)" },
  key: { minWidth: 32, height: 30, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", borderRadius: 7 },
  keyLabel: { fontFamily: fonts.mono, fontSize: 13, color: colors.text },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginHorizontal: 12,
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingLeft: 16,
    paddingRight: 5,
    paddingVertical: 5,
    minHeight: 46,
  },
  input: { flex: 1, color: colors.text, fontSize: 15, maxHeight: 120, paddingTop: 8, paddingBottom: 8, textAlignVertical: "top" },
  send: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});
