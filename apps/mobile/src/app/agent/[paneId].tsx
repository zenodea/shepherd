import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowDown, ArrowUp, ChevronLeft, Keyboard as KeyboardIcon, Maximize2, Minimize2, Sparkles, SquareTerminal } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Keyboard, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TERMINAL_KIND, type PaneReadResult, type StartAgentResult, type StyledLine } from "@sheperd/protocol";
import { agentName, agentTitle, projectOf } from "../../agents/agents";
import { parseAnsi, toStyledLines } from "../../agents/ansi";
import { PromptChips } from "../../agents/PromptCard";
import { useBlockedPrompts } from "../../agents/use-blocked-prompts";
import { useWorkspaceTabs } from "../../agents/use-workspace-tabs";
import { WorkspaceTabs } from "../../agents/WorkspaceTabs";
import { useConnection, useHostState } from "../../connection/connection";
import type { TerminalHandle, TerminalLines } from "../../connection/host-client";
import { loadPref, savePref } from "../../connection/prefs";
import { useKeyboardInset } from "../../connection/use-keyboard-inset";
import { KeyboardCapture, type KeyboardCaptureHandle } from "../../terminal/KeyboardCapture";
import { LiveTerminal, type LiveTerminalHandle } from "../../terminal/LiveTerminal";
import { TerminalView, type TerminalViewHandle, type TerminalViewMode } from "../../terminal/TerminalView";
import { ActionSheet } from "../../ui/ActionSheet";
import { IconButton } from "../../ui/IconButton";
import { PressableScale } from "../../ui/Pressable";
import { Banner, Screen } from "../../ui/Screen";
import { StatusIndicator } from "../../ui/StatusIndicator";
import { colors, fonts, space, statusColors, statusLabels } from "../../ui/theme";

const REOPEN_MS = 1500;
const SCROLLBACK_LINES = 3000;
/** herdr keeps at most this many lines of an agent's transcript. */
const TRANSCRIPT_LINES = 1000;
/** herdr may scroll an agent for up to 15s (plus 5s back) to collect its transcript. */
const TRANSCRIPT_TIMEOUT_MS = 40_000;
/** Time for herdr to let go of the phone view's controller before collecting. */
const HANDOFF_MS = 400;
/** Refresh the scrollback above the live screen when it's older than this and you scroll up. */
const SCROLLBACK_STALE_MS = 4000;

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

/** Plain text of a styled line, for matching history against the live screen. */
function lineText(line: StyledLine): string {
  return line.map((span) => span[0]).join("").trim();
}

/**
 * Cut the part of a transcript that's already on the live screen: find where
 * the screen's first lines appear (last occurrence) and keep what's above.
 */
function withoutLiveOverlap(history: StyledLine[], historyText: string[], screen: StyledLine[]): StyledLine[] {
  const probes = screen.map(lineText).filter((t) => t.length >= 6).slice(0, 8);
  for (const probe of probes) {
    const key = probe.slice(0, 40);
    for (let i = historyText.length - 1; i >= 0; i--) {
      if (historyText[i]!.startsWith(key)) return history.slice(0, i);
    }
  }
  return history;
}

type LiveScreen = { paneId: string | null; rows: StyledLine[]; cursor: TerminalLines["cursor"] | null };
const NO_LINES: StyledLine[] = [];

export default function TerminalScreen() {
  const { paneId } = useLocalSearchParams<{ paneId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const { client } = useConnection();
  const state = useHostState();
  const agent = state.agents.find((a) => a.pane_id === paneId) ?? null;
  const workspaceId = agent?.workspace_id ?? paneId?.split(":")[0] ?? null;
  const { tabs, panes } = useWorkspaceTabs(client, workspaceId, state.agents);
  const pane = panes.find((p) => p.pane_id === paneId) ?? null;
  const agentsForPrompt = useMemo(() => (agent ? [agent] : []), [agent]);
  const prompt = useBlockedPrompts(client, agentsForPrompt)[paneId ?? ""];
  const online = state.status === "online";

  // "fit" = the phone view (native lines); "native" = full width (xterm).
  const [viewMode, setViewMode] = useState<TerminalViewMode>("fit");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [newSheet, setNewSheet] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [typing, setTyping] = useState(false);

  // Phone view state.
  const [liveSize, setLiveSize] = useState<{ cols: number; rows: number } | null>(null);
  // Tagged with their pane, so switching tabs never shows another pane's content.
  const [screenState, setScreen] = useState<LiveScreen>({ paneId: null, rows: [], cursor: null });
  const [scrollbackState, setScrollback] = useState<{ paneId: string | null; lines: StyledLine[] }>({ paneId: null, lines: [] });
  const screen = screenState.paneId === paneId ? screenState : { paneId, rows: NO_LINES, cursor: null };
  const scrollback = scrollbackState.paneId === paneId ? scrollbackState.lines : NO_LINES;
  const agentStatus = agent?.agent_status ?? null;
  const isAgent = agent !== null;
  const readable = agentStatus === "idle" || agentStatus === "done";
  // Counts the agent's turns: each time it goes back to work, its transcript goes stale.
  const [turn, setTurn] = useState({ paneId, status: agentStatus, n: 0 });
  if (turn.paneId !== paneId || turn.status !== agentStatus) {
    setTurn({ paneId, status: agentStatus, n: turn.paneId === paneId && !readable ? turn.n + 1 : turn.n });
  }
  const [transcriptState, setTranscriptState] = useState<{ paneId: string | null; turn: number; ok: boolean }>({
    paneId: null,
    turn: 0,
    ok: false,
  });
  const hasTranscript = transcriptState.paneId === paneId;
  const transcriptOk = hasTranscript && transcriptState.ok;
  const scrollbackMeta = useRef<{ at: number; rows: number } | null>(null);
  // A transcript runs up to what's on screen now; show that part only once.
  const scrollbackText = useMemo(() => scrollback.map(lineText), [scrollback]);
  const history = useMemo(
    () => (transcriptOk ? withoutLiveOverlap(scrollback, scrollbackText, screen.rows) : scrollback),
    [transcriptOk, scrollback, scrollbackText, screen.rows],
  );

  // Full-width view state.
  const [webReady, setWebReady] = useState(false);

  const live = useRef<LiveTerminalHandle>(null);
  const web = useRef<TerminalViewHandle>(null);
  const capture = useRef<KeyboardCaptureHandle>(null);
  const stream = useRef<TerminalHandle | null>(null);
  const paneIdRef = useRef(paneId);
  useEffect(() => {
    paneIdRef.current = paneId;
  }, [paneId]);

  // Remember the chosen view.
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
    if (webReady && viewMode === "native") web.current?.setMode("native");
  }, [webReady, viewMode]);

  /**
   * Agents' real transcripts: herdr collects them from full-screen agents like
   * Claude Code by scrolling them while they're idle, but not while anyone
   * controls the pane. So the phone view lets go of the pane while this runs:
   * when you open an idle agent, and when you scroll up after it has worked
   * since. Busy agents fall back to herdr's scrollback below.
   */
  const needsTranscript =
    viewMode === "fit" && online && isAgent && readable && (!hasTranscript || (transcriptState.turn !== turn.n && !atBottom));
  const collectingFor = needsTranscript ? `${paneId}:${turn.n}` : null;
  useEffect(() => {
    if (!collectingFor || !client || !paneId) return;
    const target = paneId;
    const forTurn = turn.n;
    let cancelled = false;
    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, HANDOFF_MS));
      if (cancelled) return;
      let lines: StyledLine[] | null = null;
      try {
        const { read } = await client.call<{ read: PaneReadResult }>(
          "agent.read",
          { target, source: "recent_unwrapped", format: "text", lines: TRANSCRIPT_LINES },
          { timeoutMs: TRANSCRIPT_TIMEOUT_MS },
        );
        lines = toStyledLines(parseAnsi(read.text));
      } catch {
        // keep what we had; the live screen still works
      }
      if (cancelled) return;
      if (lines) setScrollback({ paneId: target, lines });
      setTranscriptState((prev) => ({ paneId: target, turn: forTurn, ok: lines !== null || (prev.paneId === target && prev.ok) }));
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on `collectingFor`, which already covers the pane and turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectingFor, client]);

  /** Shells, and agents without a transcript yet: herdr's scrollback, in colour. */
  const loadScrollback = useCallback(
    async (rows: number) => {
      if (!client || !paneId) return;
      const target = paneId;
      scrollbackMeta.current = { at: Date.now(), rows };
      try {
        const { read } = await client.call<{ read: PaneReadResult }>("pane.read", {
          pane_id: target,
          source: "recent",
          format: "ansi",
          lines: SCROLLBACK_LINES,
        });
        if (target !== paneIdRef.current) return;
        const lines = read.text.replace(/\r\n?/g, "\n").split("\n");
        const scrollback = toStyledLines(parseAnsi(lines.slice(0, Math.max(0, lines.length - rows)).join("\n")));
        // A busy agent's scrollback is only its screen; keep an earlier transcript instead.
        setScrollback((prev) =>
          isAgent && prev.paneId === target && scrollback.length < prev.lines.length ? prev : { paneId: target, lines: scrollback },
        );
      } catch {
        // the live screen still works without it
      }
    },
    [client, paneId, isAgent],
  );

  // The stream effect calls the latest loader without re-running when it changes.
  const loadScrollbackRef = useRef(loadScrollback);
  const hasTranscriptRef = useRef(false);
  useEffect(() => {
    loadScrollbackRef.current = loadScrollback;
    hasTranscriptRef.current = transcriptOk;
  }, [loadScrollback, transcriptOk]);

  // Open the stream. Phone view: the host renders styled lines at the phone's
  // size. Full width: raw frames for xterm at the pane's own size.
  const cols = liveSize?.cols;
  const rows = liveSize?.rows;
  useEffect(() => {
    if (!client || !paneId || !online) return;
    if (viewMode === "fit" && (!cols || !rows || needsTranscript)) return;
    if (viewMode === "native" && !webReady) return;

    let reopen: ReturnType<typeof setTimeout> | null = null;
    let first = true;
    const onClosed = (reason: string) => {
      stream.current = null;
      setClosedReason(reason);
      if (reason !== "disconnected") reopen = setTimeout(() => setEpoch((e) => e + 1), REOPEN_MS);
    };

    let handle: TerminalHandle | null;
    if (viewMode === "fit") {
      handle = client.openTerminal(
        paneId,
        { mode: "control", cols, rows, render: "lines" },
        {
          onLines: (update) => {
            setClosedReason(null);
            setScreen((prev) => {
              const next = update.full || prev.paneId !== paneId ? [] : prev.rows.slice(0, update.height);
              for (let y = 0; y < update.height; y++) {
                const changed = update.lines[y];
                if (changed) next[y] = changed;
                else if (next[y] === undefined) next[y] = [];
              }
              return { paneId, rows: next, cursor: update.cursor };
            });
            if (first && !hasTranscriptRef.current) void loadScrollbackRef.current(update.height);
            first = false;
          },
          onClosed,
        },
      );
    } else {
      web.current?.reset();
      handle = client.openTerminal(
        paneId,
        { mode: "observe" },
        {
          onFrame: (frame) => {
            setClosedReason(null);
            web.current?.write(frame);
          },
          onClosed,
        },
      );
    }
    stream.current = handle;
    return () => {
      if (reopen) clearTimeout(reopen);
      handle?.close();
      stream.current = null;
    };
  }, [client, paneId, online, viewMode, cols, rows, webReady, epoch, needsTranscript]);

  const onAtBottomChange = (bottom: boolean) => {
    setAtBottom(bottom);
    const meta = scrollbackMeta.current;
    // Shells: refresh the scrollback when you start reading back. (Agents'
    // transcripts are collected by scrolling the agent, so not on every look.)
    if (!bottom && !isAgent && meta && Date.now() - meta.at > SCROLLBACK_STALE_MS) void loadScrollback(meta.rows);
  };

  const toLive = () => live.current?.scrollToBottom();

  const openTerminalTab = async () => {
    if (!client || !workspaceId) return;
    try {
      const result = await client.call<StartAgentResult>("sheperd.start_agent", { kind: TERMINAL_KIND, workspaceId });
      router.setParams({ paneId: result.paneId });
    } catch (err) {
      Alert.alert("Couldn't open a terminal", (err as Error).message);
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

  const toggleTyping = () => {
    if (typing) {
      capture.current?.blur();
      return;
    }
    if (viewMode !== "fit") {
      Alert.alert("Switch to the phone view", "Typing straight into the terminal works in the phone view. Use the message box in full width.");
      return;
    }
    toLive();
    capture.current?.focus();
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
        <IconButton label={viewMode === "native" ? "Phone view" : "Full width"} onPress={toggleMode}>
          {viewMode === "native" ? <Minimize2 size={17} color={colors.text} /> : <Maximize2 size={17} color={colors.text} />}
        </IconButton>
      </View>

      {!online ? <Banner>{state.status === "connecting" ? "Connecting…" : "Can't reach your computer. Retrying…"}</Banner> : null}

      <View style={{ flex: 1, paddingBottom: keyboard.inset }}>
        <View style={styles.terminal}>
          {viewMode === "fit" ? (
            <LiveTerminal
              ref={live}
              history={history}
              screen={screen.rows}
              cursor={screen.cursor}
              onSize={(c, r) => setLiveSize((prev) => (prev?.cols === c && prev.rows === r ? prev : { cols: c, rows: r }))}
              onAtBottomChange={onAtBottomChange}
            />
          ) : (
            <TerminalView
              ref={web}
              onReady={() => setWebReady(true)}
              onFitSize={() => {}}
              onTap={() => Keyboard.dismiss()}
            />
          )}
          {needsTranscript ? (
            <View style={styles.loading} pointerEvents="none">
              <Text style={styles.loadingText}>Loading history…</Text>
            </View>
          ) : null}
          {!atBottom && viewMode === "fit" ? (
            <PressableScale onPress={toLive} style={styles.toBottom} accessibilityLabel="Back to live">
              <ArrowDown size={18} color={colors.text} />
            </PressableScale>
          ) : null}
          {closedReason && closedReason !== "closed by client" && closedReason !== "disconnected" ? (
            <Text style={styles.notice}>Terminal closed: {closedReason}</Text>
          ) : null}
        </View>

        <KeyboardCapture ref={capture} onKeys={(data) => stream.current?.input(data)} onActiveChange={setTyping} />

        <View style={[styles.bottom, { paddingBottom: keyboard.visible ? space.sm : Math.max(insets.bottom, space.sm) }]}>
          {agent?.agent_status === "blocked" && prompt ? <PromptChips key={JSON.stringify(prompt)} client={client} paneId={paneId!} prompt={prompt} /> : null}

          <WorkspaceTabs
            tabs={tabs}
            activePaneId={paneId!}
            onSelect={(tab) => {
              if (tab.paneId === paneId) return;
              setClosedReason(null);
              setAtBottom(true);
              scrollbackMeta.current = null;
              router.setParams({ paneId: tab.paneId });
            }}
            onNew={() => setNewSheet(true)}
          />

          <View style={styles.keys}>
            <PressableScale onPress={toggleTyping} style={[styles.key, styles.typeKey, typing && styles.typeKeyActive]} accessibilityLabel="Type into the terminal">
              <KeyboardIcon size={16} color={typing ? colors.onPrimary : colors.text} />
            </PressableScale>
            {QUICK_KEYS.map((group, gi) => (
              <View key={gi} style={[styles.keyGroup, styles.keyGroupDivider]}>
                {group.map((k) => (
                  <PressableScale key={k.label} onPress={() => sendKeys(k.keys, k.confirm)} style={styles.key}>
                    <Text style={styles.keyLabel}>{k.label}</Text>
                  </PressableScale>
                ))}
              </View>
            ))}
          </View>

          {!typing ? (
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder={agent ? `Message ${agentName(agent)}…` : "Run a command…"}
                placeholderTextColor={colors.subtle}
                multiline
              />
              {canSend || sending ? (
                <PressableScale onPress={submit} disabled={!canSend} style={styles.send} accessibilityLabel="Send">
                  <ArrowUp size={18} color={colors.onPrimary} strokeWidth={2.5} />
                </PressableScale>
              ) : null}
            </View>
          ) : (
            <Text style={styles.typingHint}>Typing into the terminal · tap ⌨ to stop</Text>
          )}
        </View>
      </View>

      <ActionSheet
        visible={newSheet}
        title={`New in ${agent ? projectOf(agent) : "this workspace"}`}
        onClose={() => setNewSheet(false)}
        actions={[
          {
            icon: <SquareTerminal size={19} color={colors.text} />,
            title: "Terminal",
            detail: "A new shell tab, opened right away",
            onPress: () => void openTerminalTab(),
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
  header: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  headerText: { flex: 1, gap: 3, marginLeft: 4 },
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
  loading: {
    position: "absolute",
    top: 10,
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(38,38,38,0.95)",
  },
  loadingText: { fontSize: 12, color: colors.muted },
  notice: { position: "absolute", bottom: 10, left: 12, right: 12, textAlign: "center", fontSize: 12, color: colors.muted },
  bottom: { backgroundColor: colors.background, gap: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  keys: {
    flexDirection: "row",
    alignSelf: "stretch",
    marginHorizontal: 12,
    backgroundColor: colors.raised,
    borderRadius: 11,
    height: 36,
    alignItems: "center",
    paddingHorizontal: 3,
  },
  keyGroup: { flexDirection: "row", alignItems: "center", flexGrow: 1, justifyContent: "space-around" },
  keyGroupDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.14)" },
  key: { minWidth: 30, height: 30, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", borderRadius: 7 },
  typeKey: { marginRight: 3, width: 34 },
  typeKeyActive: { backgroundColor: colors.primary },
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
  typingHint: { fontSize: 12.5, color: colors.muted, textAlign: "center", paddingVertical: 12 },
});
