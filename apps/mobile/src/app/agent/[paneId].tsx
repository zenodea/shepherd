import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowDown, Bot, Cpu, Ellipsis, Images, MessageSquareText, Search, Sparkles, SquareTerminal } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TERMINAL_KIND, type ChangesResult, type PaneReadResult, type SlashCommand, type StartAgentResult, type StyledLine } from "@shepherd/protocol";
import { useAgentActions } from "../../agents/AgentActions";
import { agentName, agentTitle, projectOf } from "../../agents/agents";
import { Composer } from "../../agents/Composer";
import { stillSending, type Sending } from "../../agents/sending";
import { ImagesContext } from "../../agents/ConversationImage";
import { SubagentsContext } from "../../agents/SubagentCard";
import { subagentsPill } from "../../agents/subagents";
import { useImagesShown } from "../../agents/image-setting";
import { Conversation, type ConversationHandle } from "../../agents/Conversation";
import { useConversation } from "../../agents/use-conversation";
import { Counts } from "../../agents/Counts";
import { useChanges } from "../../agents/use-changes";
import { useActivityLine } from "../../agents/use-activity-line";
import { contextLabel } from "../../agents/conversation-rows";
import { parseAnsi, toStyledLines } from "../../agents/ansi";
import { PromptChips } from "../../agents/PromptCard";
import { useBlockedPrompts } from "../../agents/use-blocked-prompts";
import { useWorkspaceTabs } from "../../agents/use-workspace-tabs";
import { fingerprint, useReview, viewedKey, type Review } from "../../agents/review";
import { WorkspaceTabs } from "../../agents/WorkspaceTabs";
import { useConnection, useHostState } from "../../connection/connection";
import { HostCallError, type TerminalHandle, type TerminalLines } from "../../connection/host-client";
import { loadPref, savePref } from "../../connection/prefs";
import { useKeyboardInset } from "../../connection/use-keyboard-inset";
import { KeyboardCapture, type KeyboardCaptureHandle } from "../../terminal/KeyboardCapture";
import { DEFAULT_FONT_SIZE, LiveTerminal, clampFontSize, type LiveTerminalHandle } from "../../terminal/LiveTerminal";
import { lineText } from "../../terminal/line-marks";
import { ActionSheet } from "../../ui/ActionSheet";
import { ConnectionBanner } from "../../ui/ConnectionBanner";
import { IconButton } from "../../ui/IconButton";
import { PressableScale } from "../../ui/Pressable";
import { Screen, ScreenHeader } from "../../ui/Screen";
import { StatusIndicator } from "../../ui/StatusIndicator";
import { ModelSheet } from "../../agents/ModelSheet";
import { colors, space, statusColors, statusLabels, themed } from "../../ui/theme";

/** Reopening a closed terminal stream: wait this long, doubling each time it closes again. */
const REOPEN_MS = 1500;
const MAX_REOPEN_MS = 30_000;
/** Closes that reopening won't fix: the pane is gone, or the host has too many streams open. */
const FINAL_CLOSE = /too many open terminals|not found|pane.*(closed|gone)/i;
const SCROLLBACK_LINES = 3000;
/** A sent message that never showed up in the conversation (an agent whose queue isn't visible) stops showing after this. */
const OPTIMISTIC_MS = 60_000;
/** herdr keeps at most this many lines of an agent's transcript. */
const TRANSCRIPT_LINES = 1000;
/** herdr may scroll an agent for up to 15s (plus 5s back) to collect its transcript. */
const TRANSCRIPT_TIMEOUT_MS = 40_000;
/** Time for herdr to let go of the phone view's controller before collecting. */
const HANDOFF_MS = 400;
/** Refresh the scrollback above the live screen when it's older than this and you scroll up. */
const SCROLLBACK_STALE_MS = 4000;

/** Plain text of a styled line, for matching history against the live screen. */
const plainText = (line: StyledLine) => lineText(line).trim();

/**
 * Where a transcript reaches what's already on the live screen: the last place
 * the screen's first lines appear. What's above it is history.
 */
function liveOverlap(historyText: string[], screen: StyledLine[]): number {
  const probes = screen.map(plainText).filter((t) => t.length >= 6).slice(0, 8);
  for (const probe of probes) {
    const key = probe.slice(0, 40);
    for (let i = historyText.length - 1; i >= 0; i--) {
      if (historyText[i]!.startsWith(key)) return i;
    }
  }
  return historyText.length;
}

type LiveScreen = { paneId: string | null; rows: StyledLine[]; cursor: TerminalLines["cursor"] | null };
const NO_LINES: StyledLine[] = [];
/** A message you sent, with the pane it went to. */
type Outgoing = Sending & { paneId: string };

/** "2 comments" while a review waits to be sent, else "3 left to view" once some are viewed; nothing before you start. */
function reviewLabel(review: Review, changes: Extract<ChangesResult, { available: true }>): string | null {
  if (review.comments.length) return `${review.comments.length} comment${review.comments.length === 1 ? "" : "s"}`;
  const files = changes.files.filter((f) => !f.generated);
  const viewed = files.filter((f) => review.viewed[viewedKey(changes.mode, f.path)] === fingerprint(f)).length;
  return viewed > 0 && viewed < files.length ? `${files.length - viewed} left to view` : null;
}

export default function TerminalScreen() {
  const { paneId, host: linkedHost } = useLocalSearchParams<{ paneId: string; host?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const { client, settings, hosts, switchTo } = useConnection();
  // Notification links name their computer; switch to it if it isn't the one in use.
  useEffect(() => {
    if (linkedHost && settings && linkedHost !== settings.id && hosts.some((h) => h.id === linkedHost)) void switchTo(linkedHost);
  }, [linkedHost, settings, hosts, switchTo]);
  const state = useHostState();
  const agent = state.agents.find((a) => a.pane_id === paneId) ?? null;
  const workspaceId = agent?.workspace_id ?? paneId?.split(":")[0] ?? null;
  const { tabs, panes } = useWorkspaceTabs(client, workspaceId, state.agents);
  const pane = panes.find((p) => p.pane_id === paneId) ?? null;
  const agentsForPrompt = useMemo(() => (agent ? [agent] : []), [agent]);
  const prompt = useBlockedPrompts(client, agentsForPrompt)[paneId ?? ""];
  const online = state.status === "online";
  const imagesShown = useImagesShown();
  const actions = useAgentActions(client, {
    extra: [
      ...(agent
        ? [
            {
              icon: <Cpu size={19} color={colors.text} />,
              title: "Model",
              detail: "Switch model and effort",
              onPress: () => setModelSheet(true),
            },
          ]
        : []),
      // With "Show images" on: every image in the conversation on one page.
      ...(imagesShown && agent
        ? [
            {
              icon: <Images size={19} color={colors.text} />,
              title: "Images",
              detail: "Every image in this conversation",
              onPress: () => router.push({ pathname: "/images/[paneId]", params: { paneId: paneId! } }),
            },
          ]
        : []),
    ],
    // Go to another tab in the workspace if there is one, else back to the list.
    onClosed: (closed) => {
      const next = tabs.find((t) => t.paneId !== closed);
      if (next) router.setParams({ paneId: next.paneId });
      else if (router.canGoBack()) router.back();
      else router.replace("/");
    },
  });

  const draftKey = `${settings?.id ?? "none"}:${paneId}`;
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [newSheet, setNewSheet] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [typing, setTyping] = useState(false);
  const [searching, setSearching] = useState(false);
  const [modelSheet, setModelSheet] = useState(false);
  // Landscape leaves little height, so the tab strip steps aside.
  const window = useWindowDimensions();
  const landscape = window.width > window.height;
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  useEffect(() => {
    void loadPref("terminalFontSize").then((v) => {
      if (v && Number(v)) setFontSize(clampFontSize(Number(v)));
    });
  }, []);
  const changeFontSize = (size: number) => {
    setFontSize(size);
    void savePref("terminalFontSize", String(size));
  };
  // Agents open on their conversation (read from their transcript) when there is one.
  const [view, setView] = useState<"chat" | "terminal">("chat");
  useEffect(() => {
    void loadPref("agentView").then((v) => {
      if (v === "terminal" || v === "chat") setView(v);
    });
  }, []);
  const switchView = () => {
    const next = view === "chat" ? "terminal" : "chat";
    setView(next);
    setSearching(false);
    void savePref("agentView", next);
  };

  // Phone view state.
  const [liveSize, setLiveSize] = useState<{ cols: number; rows: number } | null>(null);
  // Tagged with their pane, so switching tabs never shows another pane's content.
  const [screenState, setScreen] = useState<LiveScreen>({ paneId: null, rows: [], cursor: null });
  const [scrollbackState, setScrollback] = useState<{ paneId: string | null; lines: StyledLine[] }>({ paneId: null, lines: [] });
  const screen = screenState.paneId === paneId ? screenState : { paneId, rows: NO_LINES, cursor: null };
  const scrollback = scrollbackState.paneId === paneId ? scrollbackState.lines : NO_LINES;
  const agentStatus = agent?.agent_status ?? null;
  const isAgent = agent !== null;
  const conversation = useConversation(client, isAgent ? paneId : null, online, null, settings?.id ?? null);
  // The chat only gets a reply once it's finished; meanwhile, show what the agent's screen says it's doing.
  const activity = useActivityLine(client, paneId, online && agent?.agent_status === "working" && view === "chat");
  const chatAvailable = isAgent && conversation.available !== false;
  const chat = chatAvailable && view === "chat";
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
  // Cut where it overlaps (an index, so a new frame at the same place keeps the same history).
  const scrollbackText = useMemo(() => scrollback.map(plainText), [scrollback]);
  const cut = useMemo(
    () => (transcriptOk ? liveOverlap(scrollbackText, screen.rows) : scrollbackText.length),
    [transcriptOk, scrollbackText, screen.rows],
  );
  const history = useMemo(() => (cut === scrollback.length ? scrollback : scrollback.slice(0, cut)), [scrollback, cut]);

  const live = useRef<LiveTerminalHandle>(null);
  const conversationView = useRef<ConversationHandle>(null);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const outgoingIds = useRef(0);
  const shownOutgoing = useMemo(
    () => stillSending(outgoing.filter((s) => s.paneId === paneId), conversation.entries, conversation.queued),
    [outgoing, paneId, conversation.entries, conversation.queued],
  );
  const subagentLinks = useMemo(
    () => ({
      byId: new Map(conversation.subagents.map((s) => [s.id, s])),
      open: (id: string) => router.push({ pathname: "/subagent/[paneId]/[id]", params: { paneId: paneId!, id } }),
    }),
    [conversation.subagents, router, paneId],
  );
  const images = useMemo(
    () => ({ client, paneId, session: conversation.session, auto: imagesShown }),
    [client, paneId, conversation.session, imagesShown],
  );
  const capture = useRef<KeyboardCaptureHandle>(null);
  const stream = useRef<TerminalHandle | null>(null);
  const paneIdRef = useRef(paneId);
  useEffect(() => {
    paneIdRef.current = paneId;
  }, [paneId]);

  /**
   * Agents' real transcripts: herdr collects them from full-screen agents like
   * Claude Code by scrolling them while they're idle, but not while anyone
   * controls the pane. So the phone view lets go of the pane while this runs:
   * when you open an idle agent, and when you scroll up after it has worked
   * since. Busy agents fall back to herdr's scrollback below.
   */
  const needsTranscript = online && isAgent && !chat && readable && (!hasTranscript || (transcriptState.turn !== turn.n && !atBottom));
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

  // Open the stream: the host renders styled lines at the phone's size.
  const cols = liveSize?.cols;
  const rows = liveSize?.rows;
  const reopenMs = useRef(REOPEN_MS);
  useEffect(() => {
    if (!client || !paneId || !online || chat) return;
    if (!cols || !rows || needsTranscript) return;

    let reopen: ReturnType<typeof setTimeout> | null = null;
    let first = true;
    const onClosed = (reason: string) => {
      stream.current = null;
      setClosedReason(reason);
      if (reason === "disconnected" || FINAL_CLOSE.test(reason)) return;
      reopen = setTimeout(() => setEpoch((e) => e + 1), reopenMs.current);
      reopenMs.current = Math.min(reopenMs.current * 2, MAX_REOPEN_MS);
    };

    const handle = client.openTerminal(
      paneId,
      { mode: "control", cols, rows, render: "lines" },
      {
        onLines: (update) => {
          reopenMs.current = REOPEN_MS;
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
    stream.current = handle;
    return () => {
      if (reopen) clearTimeout(reopen);
      handle?.close();
      stream.current = null;
    };
  }, [client, paneId, online, cols, rows, epoch, needsTranscript, chat]);

  const onAtBottomChange = (bottom: boolean) => {
    setAtBottom(bottom);
    const meta = scrollbackMeta.current;
    // Shells: refresh the scrollback when you start reading back. (Agents'
    // transcripts are collected by scrolling the agent, so not on every look.)
    if (!bottom && !isAgent && meta && Date.now() - meta.at > SCROLLBACK_STALE_MS) void loadScrollback(meta.rows);
  };

  const toLive = () => (chat ? conversationView.current?.scrollToBottom() : live.current?.scrollToBottom());

  const openTerminalTab = async () => {
    if (!client || !workspaceId) return;
    try {
      const result = await client.call<StartAgentResult>("shepherd.start_agent", { kind: TERMINAL_KIND, workspaceId });
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

  const send = async (text: string, command: SlashCommand | null): Promise<boolean> => {
    if (!client || !paneId) return false;
    // The app has its own picker for this one.
    if (command?.opens === "model" && text.trim() === command.name) {
      setModelSheet(true);
      return true;
    }
    const optimistic = { id: String(++outgoingIds.current), paneId, text, after: conversation.entries.at(-1)?.id ?? -1 };
    // A command isn't a message: it never shows up in the conversation to replace the bubble.
    if (agent && chat && !command) {
      setOutgoing((list) => [...list, optimistic]);
      conversationView.current?.scrollToBottom();
    }
    const forget = () => setOutgoing((list) => list.filter((s) => s.id !== optimistic.id));
    try {
      if (agent) await client.call("agent.prompt", { target: paneId, text });
      else await client.call("pane.send_input", { pane_id: paneId, text, keys: ["enter"] });
      setTimeout(forget, OPTIMISTIC_MS);
      // What it shows is drawn in the terminal.
      if (command?.opens === "terminal") setView("terminal");
      toLive();
      return true;
    } catch (err) {
      forget();
      // herdr won't type a message into an agent that's waiting for an answer: it would become the answer.
      if (err instanceof HostCallError && err.code === "agent_blocked" && agent) {
        Alert.alert(`${agentName(agent)} is waiting for an answer`, "Answer its question first, then send this. Your message is still here.");
      } else {
        Alert.alert("Couldn't send", (err as Error).message);
      }
      return false;
    }
  };

  const toggleTyping = () => {
    if (typing) {
      capture.current?.blur();
      return;
    }
    toLive();
    capture.current?.focus();
  };

  const title = agent ? (agentTitle(agent) ?? agentName(agent)) : (pane?.terminal_title_stripped ?? pane?.title ?? "Terminal");
  const usage = isAgent ? contextLabel(conversation.context) : null;
  const { changes } = useChanges(client, isAgent ? paneId : null, online, agentStatus);
  const changed = changes?.available && changes.files.length > 0 ? changes : null;
  // Once you've started reviewing: what's left to look at, and comments not sent yet.
  const review = useReview(`${settings?.id ?? "none"}:${paneId}`);
  const reviewNote = changed ? reviewLabel(review, changed) : null;
  const subagentsLabel = subagentsPill(conversation.subagents);

  return (
    <Screen>
      <ScreenHeader
        title={title}
        metaIcon={agent ? <StatusIndicator status={agent.agent_status} size={7} /> : null}
        meta={
          agent ? (
            <>
              <Text style={{ color: agent.agent_status === "idle" ? colors.subtle : statusColors[agent.agent_status] }}>{statusLabels[agent.agent_status]}</Text>
              {`  ·  ${agentName(agent)}  ·  ${projectOf(agent)}`}
              {usage ? <Text style={usage.high ? { color: statusColors.blocked } : undefined}>{`  ·  ${usage.text}`}</Text> : null}
            </>
          ) : (
            `Shell  ·  ${pane?.cwd?.split("/").filter(Boolean).pop() ?? paneId}`
          )
        }
        right={
          <>
            {chatAvailable ? (
              <IconButton label={chat ? "Show the terminal" : "Show the conversation"} onPress={switchView} filled={false}>
                {chat ? <SquareTerminal size={18} color={colors.muted} /> : <MessageSquareText size={18} color={colors.muted} />}
              </IconButton>
            ) : null}
            {chat ? null : (
              <IconButton label="Find in terminal" onPress={() => setSearching((s) => !s)} filled={false}>
                <Search size={18} color={searching ? colors.text : colors.muted} />
              </IconButton>
            )}
            <IconButton label="More" onPress={() => workspaceId && actions.show(paneId!, workspaceId, agent)} filled={false}>
              <Ellipsis size={19} color={colors.muted} />
            </IconButton>
          </>
        }
      />

      {changed || subagentsLabel ? (
        <View style={styles.pills}>
          {changed ? (
            <PressableScale
              onPress={() => router.push({ pathname: "/changes/[paneId]", params: { paneId: paneId! } })}
              style={styles.pill}
              accessibilityLabel={`${changed.files.length + (changed.omitted ?? 0)} changed files`}
            >
              <Text style={[styles.changesText, styles.pillFixed]}>
                {`${changed.files.length + (changed.omitted ?? 0)} file${changed.files.length + (changed.omitted ?? 0) === 1 ? "" : "s"}  ·  `}
              </Text>
              <Counts additions={changed.additions} deletions={changed.deletions} size={12.5} />
              {reviewNote ? (
                <Text style={[styles.changesText, styles.pillFlexible]} numberOfLines={1}>
                  {`  ·  ${reviewNote}`}
                </Text>
              ) : changed.mode === "branch" ? (
                <Text style={[styles.changesText, styles.pillFlexible, styles.pillBranch]} numberOfLines={1}>
                  {`·  on ${changed.branch}`}
                </Text>
              ) : null}
            </PressableScale>
          ) : null}
          {subagentsLabel ? (
            <PressableScale
              onPress={() => router.push({ pathname: "/subagents/[paneId]", params: { paneId: paneId! } })}
              style={[styles.pill, styles.pillSecond]}
              accessibilityLabel={subagentsLabel}
            >
              <Bot size={13} color={colors.muted} />
              <Text style={[styles.changesText, styles.pillFlexible]} numberOfLines={1}>{` ${subagentsLabel}`}</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
      <View style={styles.headerLine} />

      <ConnectionBanner />

      <View style={{ flex: 1, paddingBottom: keyboard.inset }}>
        {chat ? (
          <SubagentsContext.Provider value={subagentLinks}>
            <ImagesContext.Provider value={images}>
              <Conversation
                ref={conversationView}
                entries={conversation.entries}
                queued={conversation.queued}
                sending={shownOutgoing}
                ready={conversation.available === true}
                working={agent?.agent_status === "working"}
                activity={activity}
                atStart={conversation.atStart}
                loadingOlder={conversation.loadingOlder}
                onLoadOlder={conversation.loadOlder}
              />
            </ImagesContext.Provider>
          </SubagentsContext.Provider>
        ) : (
          <View style={styles.terminal}>
            <LiveTerminal
              ref={live}
              history={history}
              fontSize={fontSize}
              onFontSizeChange={changeFontSize}
              searching={searching}
              onCloseSearch={() => setSearching(false)}
              screen={screen.rows}
              cursor={screen.cursor}
              onSize={(c, r) => setLiveSize((prev) => (prev?.cols === c && prev.rows === r ? prev : { cols: c, rows: r }))}
              onAtBottomChange={onAtBottomChange}
            />

            {needsTranscript ? (
              <View style={styles.loading} pointerEvents="none">
                <Text style={styles.loadingText}>Loading history…</Text>
              </View>
            ) : null}
            {!atBottom ? (
              <PressableScale onPress={toLive} style={styles.toBottom} accessibilityLabel="Back to live">
                <ArrowDown size={18} color={colors.text} />
              </PressableScale>
            ) : null}
            {closedReason && closedReason !== "closed by client" && closedReason !== "disconnected" ? (
              <Text style={styles.notice}>Terminal closed: {closedReason}</Text>
            ) : null}
          </View>
        )}

        <KeyboardCapture ref={capture} onKeys={(data) => stream.current?.input(data)} onActiveChange={setTyping} />

        <View style={[styles.bottom, { paddingBottom: keyboard.visible ? space.sm : Math.max(insets.bottom, space.sm) }]}>
          {agent?.agent_status === "blocked" && prompt ? <PromptChips key={JSON.stringify(prompt)} client={client} paneId={paneId!} prompt={prompt} /> : null}

          {landscape ? null : (
            <WorkspaceTabs
              tabs={tabs}
              activePaneId={paneId!}
              onSelect={(tab) => {
                if (tab.paneId === paneId) return;
                setClosedReason(null);
                setAtBottom(true);
                scrollbackMeta.current = null;
                reopenMs.current = REOPEN_MS;
                router.setParams({ paneId: tab.paneId });
              }}
              onNew={() => setNewSheet(true)}
            />
          )}

          <Composer
            key={draftKey}
            client={client}
            agent={agent}
            draftKey={draftKey}
            chat={chat}
            typing={typing}
            onToggleTyping={toggleTyping}
            onKeys={(keys, confirm) => void sendKeys(keys, confirm)}
            onSend={send}
          />
        </View>
      </View>

      {actions.element}
      {agent && paneId ? <ModelSheet client={client} paneId={paneId} name={agentName(agent)} visible={modelSheet} onClose={() => setModelSheet(false)} /> : null}
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

const styles = themed(() => StyleSheet.create({
  terminal: { flex: 1, backgroundColor: colors.terminal },
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
  loading: {
    position: "absolute",
    top: 10,
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.floating,
  },
  loadingText: { fontSize: 12, color: colors.muted },
  notice: { position: "absolute", bottom: 10, left: 12, right: 12, textAlign: "center", fontSize: 12, color: colors.muted },
  bottom: { backgroundColor: colors.background, gap: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  // Matches the line above the composer at the bottom.
  headerLine: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline },
  pills: { flexDirection: "row", gap: 6, marginHorizontal: space.md, marginBottom: 6 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
    flexShrink: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.raised,
  },
  changesText: { fontSize: 12.5, color: colors.muted },
  pillFixed: { flexShrink: 0 },
  pillFlexible: { flexShrink: 1 },
  pillBranch: { marginLeft: 8 },
  // Both pills stay on one line: the changes pill (its branch name) gives way first.
  pillSecond: { flexShrink: 0 },
}));
