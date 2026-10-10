import { Redirect, useRouter } from "expo-router";
import { Activity, Bot, Check, ChevronDown, Laptop, Plus, QrCode, Settings, SquareTerminal } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AgentInfo, BlockedPrompt } from "@shepherd/protocol";
import { useAgentActions } from "../agents/AgentActions";
import { agoLabel } from "../agents/activity";
import { agentName, agentTitle, projectOf } from "../agents/agents";
import { PromptCard } from "../agents/PromptCard";
import { useActivity } from "../agents/use-activity";
import { useBlockedPrompts } from "../agents/use-blocked-prompts";
import { tabsOf, useSnapshot, type WorkspaceTab } from "../agents/use-workspace-tabs";
import { blockedAgents, countAgents, sortAgents, visibleAgents } from "../connection/computers";
import { useComputerStates, useConnection, useHostState, type Computer } from "../connection/connection";
import type { ConnectionStatus, HostConnection, HostState } from "../connection/host-client";
import { prefSwitch } from "../connection/pref-switch";
import { ActionSheet } from "../ui/ActionSheet";
import { AgentMark } from "../ui/AgentMark";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { PressableScale } from "../ui/Pressable";
import { ConnectionBanner } from "../ui/ConnectionBanner";
import { Screen, SectionHeader } from "../ui/Screen";
import { StatusIndicator } from "../ui/StatusIndicator";
import { colors, radii, space, statusColors, statusLabels, statusRank, type, themed } from "../ui/theme";

/** The home screen lists agents, or every herdr space with its tabs (agents and plain terminals). */
const spacesView = prefSwitch("home-spaces", false);

const NO_AGENTS: AgentInfo[] = [];

/** How the home screen opens an agent or terminal, and its long-press actions, on a given computer. */
type Handlers = {
  open: (computer: Computer, paneId: string) => void;
  more: (computer: Computer, paneId: string, workspaceId: string, agent: AgentInfo | null) => void;
};

export default function AgentsScreen() {
  // For "Last done: 12m ago" on each agent.
  const now = useNow(30_000);
  const router = useRouter();
  const { settings, hosts, client, computers, switchTo } = useConnection();
  const state = useHostState();
  const states = useComputerStates(computers);
  // With more than one computer paired, every computer's agents are listed (see ComputerAgents).
  const multi = computers.length > 1;
  const [refreshing, setRefreshing] = useState(false);
  const [hostSheet, setHostSheet] = useState(false);
  const prompts = useBlockedPrompts(client, multi ? NO_AGENTS : state.agents);
  const activity = useActivity(client, settings?.id ?? null, state.status === "online");
  // Long-press actions go to the computer the agent is on.
  const [actionsClient, setActionsClient] = useState<HostConnection | null>(null);
  const actions = useAgentActions(multi ? (actionsClient ?? client) : client);
  const showSpaces = spacesView.use();
  const snapshot = useSnapshot(client, !multi && showSpaces && state.status === "online");
  const spaces = useMemo(
    () => (snapshot ? snapshot.workspaces.map((w) => ({ id: w.workspace_id, label: w.label, tabs: tabsOf(snapshot, w.workspace_id, state.agents).tabs })) : null),
    [snapshot, state.agents],
  );

  const { blocked, groups } = useMemo(() => {
    const sorted = [...state.agents].sort(
      (a, b) => statusRank[a.agent_status] - statusRank[b.agent_status] || a.pane_id.localeCompare(b.pane_id),
    );
    const byProject = new Map<string, AgentInfo[]>();
    for (const agent of sorted) {
      if (agent.agent_status === "blocked") continue;
      const project = projectOf(agent);
      byProject.set(project, [...(byProject.get(project) ?? []), agent]);
    }
    return { blocked: sorted.filter((a) => a.agent_status === "blocked"), groups: [...byProject.entries()] };
  }, [state.agents]);

  if (settings === undefined) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.background }} color={colors.muted} />;
  if (settings === null) return <Redirect href="/connect" />;

  const refresh = async () => {
    setRefreshing(true);
    try {
      // the banner and each computer's heading show connection problems
      await Promise.allSettled(computers.filter((_, i) => states[i]?.status === "online").map((c) => c.client.call("agent.list")));
    } finally {
      setRefreshing(false);
    }
  };

  const online = state.status === "online";
  const hostName = state.host?.name ?? settings.name ?? "Host";
  const counts = multi ? countAgents(states) : { total: state.agents.length, working: state.agents.filter((a) => a.agent_status === "working").length, blocked: blocked.length };
  const anyOnline = multi ? states.some((s) => s.status === "online") : online;
  const open = (agent: AgentInfo) => router.push({ pathname: "/agent/[paneId]", params: { paneId: agent.pane_id } });
  const handlers: Handlers = {
    open: (computer, paneId) => {
      const go = () => router.push({ pathname: "/agent/[paneId]", params: computer.active ? { paneId } : { paneId, host: computer.host.id } });
      // Switch first, so the agent screen doesn't briefly show a pane with the same id on the computer in use.
      if (computer.active) go();
      else void switchTo(computer.host.id).finally(go);
    },
    more: (computer, paneId, workspaceId, agent) => {
      setActionsClient(computer.active ? null : computer.client);
      actions.show(paneId, workspaceId, agent);
    },
  };

  return (
    <Screen>
      <View style={styles.header}>
        <PressableScale
          onPress={() => setHostSheet(true)}
          style={styles.hostChip}
          accessibilityRole="button"
          accessibilityLabel={`${hostName}, ${statusText(state)}. Switch computer`}
        >
          <View style={[styles.hostDot, { backgroundColor: dotColor(state.status) }]} />
          <Text style={styles.hostName} numberOfLines={1}>
            {hostName}
          </Text>
          <ChevronDown size={14} color={colors.muted} />
        </PressableScale>
        <View style={{ flex: 1 }} />
        <View>
          <IconButton label="Activity" onPress={() => router.push("/activity")} filled={false}>
            <Activity size={19} color={colors.muted} />
          </IconButton>
          {activity.unseen > 0 ? <View style={styles.badge} pointerEvents="none" /> : null}
        </View>
        <IconButton label="Settings" onPress={() => router.push("/settings")} filled={false}>
          <Settings size={19} color={colors.muted} />
        </IconButton>
        {online ? (
          <IconButton label="New agent" onPress={() => router.push("/new")}>
            <Plus size={20} color={colors.text} />
          </IconButton>
        ) : null}
      </View>

      <View style={styles.titleBlock}>
        <View style={styles.views} accessibilityRole="tablist">
          {(["Agents", "Spaces"] as const).map((view) => {
            const selected = showSpaces === (view === "Spaces");
            return (
              <PressableScale key={view} onPress={() => spacesView.set(view === "Spaces")} highlight={false} accessibilityRole="tab" accessibilityState={{ selected }}>
                <Text style={[type.largeTitle, !selected && { color: colors.subtle }]}>{view}</Text>
              </PressableScale>
            );
          })}
        </View>
        {anyOnline ? <Text style={type.sub}>{summary(counts.total, counts.working, counts.blocked)}</Text> : null}
      </View>

      <ConnectionBanner pairHint="Tap the host name to pair." />

      <ScrollView
        contentContainerStyle={{ paddingBottom: space.xxl * 2 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
      >
        {multi && showSpaces
          ? computers.map((computer, i) => (
              <ComputerSpaces key={computer.host.id} computer={computer} state={states[i] ?? IDLE_STATE} now={now} handlers={handlers} />
            ))
          : null}

        {multi && !showSpaces && counts.blocked > 0 ? (
          <>
            <SectionHeader title="Needs you" count={counts.blocked} />
            <View style={{ gap: space.md, paddingHorizontal: space.lg }}>
              {computers.map((computer, i) => (
                <ComputerBlocked key={computer.host.id} computer={computer} state={states[i] ?? IDLE_STATE} handlers={handlers} />
              ))}
            </View>
          </>
        ) : null}

        {multi && !showSpaces
          ? computers.map((computer, i) => (
              <ComputerAgents key={computer.host.id} computer={computer} state={states[i] ?? IDLE_STATE} now={now} handlers={handlers} />
            ))
          : null}

        {multi ? null : showSpaces ? (
          online && !spaces ? (
            <ActivityIndicator style={{ marginTop: space.xl }} color={colors.muted} />
          ) : (
            spaces?.map((ws) => (
              <View key={ws.id}>
                <SectionHeader title={ws.label} count={ws.tabs.length} />
                {ws.tabs.map((tab) =>
                  tab.agent ? (
                    <AgentRow
                      key={tab.tabId}
                      agent={tab.agent}
                      now={now}
                      onPress={() => open(tab.agent!)}
                      onLongPress={() => actions.show(tab.paneId, ws.id, tab.agent)}
                    />
                  ) : (
                    <TerminalRow key={tab.tabId} tab={tab} onPress={() => router.push({ pathname: "/agent/[paneId]", params: { paneId: tab.paneId } })} />
                  ),
                )}
              </View>
            ))
          )
        ) : null}

        {!multi && !showSpaces && blocked.length > 0 ? (
          <>
            <SectionHeader title="Needs you" count={blocked.length} />
            <View style={{ gap: space.md, paddingHorizontal: space.lg }}>
              {blocked.map((agent) => (
                <BlockedCard
                  key={agent.pane_id}
                  agent={agent}
                  client={client}
                  prompt={prompts[agent.pane_id]}
                  onOpen={() => open(agent)}
                  onMore={() => actions.show(agent.pane_id, agent.workspace_id, agent)}
                />
              ))}
            </View>
          </>
        ) : null}

        {multi || showSpaces ? null : groups.map(([project, agents]) => (
          <View key={project}>
            <SectionHeader title={project} count={agents.length} />
            {agents.map((agent) => (
              <AgentRow
                key={agent.pane_id}
                agent={agent}
                now={now}
                onPress={() => open(agent)}
                onLongPress={() => actions.show(agent.pane_id, agent.workspace_id, agent)}
              />
            ))}
          </View>
        ))}

        {!multi && online && (showSpaces ? spaces?.length === 0 : state.agents.length === 0) ? (
          <View style={styles.empty}>
            <Text style={type.title}>{showSpaces ? "No spaces open" : "No agents running"}</Text>
            <Text style={[type.sub, { textAlign: "center" }]}>Start one here, or in herdr on your computer.</Text>
            <Button title="Start an agent" onPress={() => router.push("/new")} style={{ marginTop: space.md, alignSelf: "stretch" }} />
          </View>
        ) : null}
      </ScrollView>

      {actions.element}
      <ActionSheet
        visible={hostSheet}
        title="Computers"
        onClose={() => setHostSheet(false)}
        actions={[
          ...hosts.map((host) => {
            const active = host.id === settings.id;
            return {
              key: host.id,
              icon: <Laptop size={19} color={colors.text} />,
              title: active ? hostName : (host.name ?? "Computer"),
              detail: active ? statusText(state) : "Switch to this computer",
              trailing: active ? <Check size={18} color={colors.text} /> : null,
              onPress: () => void switchTo(host.id),
            };
          }),
          {
            key: "add",
            separated: true,
            icon: <QrCode size={19} color={colors.text} />,
            title: "Add a computer",
            detail: "Scan the QR code in the Shepherd window on another computer",
            onPress: () => router.push("/scan"),
          },
        ]}
      />
    </Screen>
  );
}

const IDLE_STATE: HostState = { status: "idle", network: true, error: null, host: null, activeUrl: null, urls: [], device: null, agents: [] };

/** Online, connecting, or not reachable. */
function dotColor(status: ConnectionStatus): string {
  return status === "online" ? statusColors.done : status === "connecting" || status === "idle" ? colors.subtle : colors.danger;
}

function computerName(computer: Computer, state: HostState): string {
  return state.host?.name ?? computer.host.name ?? "Computer";
}

/** A computer's name and connection, heading its agents or spaces. */
function ComputerHeader({ computer, state, count }: { computer: Computer; state: HostState; count?: number }) {
  const name = computerName(computer, state);
  return (
    <View style={styles.computerHeader} accessibilityRole="header" accessibilityLabel={`${name}, ${statusText(state)}`}>
      <View style={[styles.hostDot, { backgroundColor: dotColor(state.status) }]} />
      <Text style={[type.section, { flexShrink: 1 }]} numberOfLines={1}>
        {name}
      </Text>
      {count !== undefined ? <Text style={[type.mono, { color: colors.subtle }]}>{count}</Text> : null}
    </View>
  );
}

/** A muted line under a computer's heading. */
function ComputerNote({ children }: { children: string }) {
  return <Text style={styles.computerNote}>{children}</Text>;
}

/** Why nothing is listed for a computer that isn't connected, or null when it is. */
function offlineNote(state: HostState): string | null {
  if (state.status === "online") return null;
  if (state.network && (state.status === "connecting" || state.status === "idle")) return "Connecting…";
  return statusText(state);
}

/** A computer's agents that need you, answered through that computer's connection. */
function ComputerBlocked({ computer, state, handlers }: { computer: Computer; state: HostState; handlers: Handlers }) {
  const blocked = useMemo(() => sortAgents(blockedAgents(state), statusRank), [state]);
  const prompts = useBlockedPrompts(computer.client, blocked);
  const name = computerName(computer, state);
  return blocked.map((agent) => (
    <BlockedCard
      key={agent.pane_id}
      agent={agent}
      computer={name}
      client={computer.client}
      prompt={prompts[agent.pane_id]}
      onOpen={() => handlers.open(computer, agent.pane_id)}
      onMore={() => handlers.more(computer, agent.pane_id, agent.workspace_id, agent)}
    />
  ));
}

/** One computer's agents (those that need you are listed above, under "Needs you"). */
function ComputerAgents({ computer, state, now, handlers }: { computer: Computer; state: HostState; now: number; handlers: Handlers }) {
  const agents = useMemo(() => visibleAgents(state), [state]);
  const rows = useMemo(() => {
    const blocked = new Set(blockedAgents(state).map((a) => a.pane_id));
    return sortAgents(agents, statusRank).filter((a) => !blocked.has(a.pane_id));
  }, [state, agents]);
  const note =
    rows.length > 0 ? null : agents.length > 0 && state.status === "online" ? "Waiting on you, above" : (offlineNote(state) ?? "No agents running");
  return (
    <View>
      <ComputerHeader computer={computer} state={state} count={state.status === "online" ? agents.length : undefined} />
      {note ? <ComputerNote>{note}</ComputerNote> : null}
      {rows.map((agent) => (
        <AgentRow
          key={agent.pane_id}
          agent={agent}
          project={projectOf(agent)}
          now={now}
          onPress={() => handlers.open(computer, agent.pane_id)}
          onLongPress={() => handlers.more(computer, agent.pane_id, agent.workspace_id, agent)}
        />
      ))}
    </View>
  );
}

/** One computer's herdr spaces and their tabs. */
function ComputerSpaces({ computer, state, now, handlers }: { computer: Computer; state: HostState; now: number; handlers: Handlers }) {
  const online = state.status === "online";
  const snapshot = useSnapshot(computer.client, online);
  const spaces = useMemo(
    () => (snapshot ? snapshot.workspaces.map((w) => ({ id: w.workspace_id, label: w.label, tabs: tabsOf(snapshot, w.workspace_id, state.agents).tabs })) : null),
    [snapshot, state.agents],
  );
  const note = offlineNote(state) ?? (spaces?.length === 0 ? "No spaces open" : null);
  return (
    <View>
      <ComputerHeader computer={computer} state={state} count={online && spaces ? spaces.length : undefined} />
      {note ? <ComputerNote>{note}</ComputerNote> : null}
      {online && !spaces ? <ActivityIndicator style={styles.computerLoading} color={colors.muted} /> : null}
      {online
        ? spaces?.map((ws) => (
            <View key={ws.id}>
              <Text style={styles.spaceLabel} numberOfLines={1}>
                {ws.label}
              </Text>
              {ws.tabs.map((tab) =>
                tab.agent ? (
                  <AgentRow
                    key={tab.tabId}
                    agent={tab.agent}
                    now={now}
                    onPress={() => handlers.open(computer, tab.paneId)}
                    onLongPress={() => handlers.more(computer, tab.paneId, ws.id, tab.agent)}
                  />
                ) : (
                  <TerminalRow key={tab.tabId} tab={tab} onPress={() => handlers.open(computer, tab.paneId)} />
                ),
              )}
            </View>
          ))
        : null}
    </View>
  );
}

function statusText(state: HostState): string {
  if (state.status === "online") return "Connected";
  if (state.status === "unauthorized") return "Not paired";
  if (!state.network) return "No network";
  if (state.status === "connecting") return "Connecting…";
  return "Can't reach it";
}

function summary(total: number, working: number, blocked: number): string {
  const parts = [`${total} agent${total === 1 ? "" : "s"}`];
  if (working) parts.push(`${working} working`);
  if (blocked) parts.push(`${blocked} need${blocked === 1 ? "s" : ""} you`);
  return parts.join(" · ");
}

/** The time now, updated every `ms`, for labels like "12m ago". */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

function AgentRow({
  agent,
  project,
  now,
  onPress,
  onLongPress,
}: {
  agent: AgentInfo;
  /** Shown after the agent's name, when the list isn't grouped by project. */
  project?: string;
  now: number;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const title = agentTitle(agent) ?? agentName(agent);
  // Finished or waiting, but subagents it started are still at work.
  const subagents = agent.agent_status === "working" ? 0 : (agent.subagents_running ?? 0);
  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${agentName(agent)}, ${statusLabels[agent.agent_status]}${subagents ? `, ${subagents} subagent${subagents === 1 ? "" : "s"} running` : ""}`}
      accessibilityHint="Opens the terminal. Long-press for more."
    >
      <AgentMark agent={agent.agent} size={32} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={type.row} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[type.sub, { flexShrink: 1 }]} numberOfLines={1}>
            <Text style={{ color: agent.agent_status === "idle" ? colors.subtle : statusColors[agent.agent_status] }}>
              {statusLabels[agent.agent_status]}
            </Text>
            {`  ·  ${agentName(agent)}${project ? `  ·  ${project}` : ""}`}
          </Text>
          {subagents ? (
            <View style={styles.subagents}>
              <Bot size={12} color={statusColors.working} />
              <Text style={styles.subagentsText}>{subagents}</Text>
            </View>
          ) : null}
        </View>
        {agent.last_done_at ? (
          <Text style={styles.lastDone} numberOfLines={1}>
            Last done: {agoLabel(agent.last_done_at, now)}
          </Text>
        ) : null}
      </View>
      <View style={styles.statusSlot}>
        <StatusIndicator status={agent.agent_status} />
      </View>
    </PressableScale>
  );
}

function TerminalRow({ tab, onPress }: { tab: WorkspaceTab; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} style={styles.row} accessibilityLabel={`${tab.label}, terminal`} accessibilityHint="Opens the terminal.">
      <View style={styles.terminalMark}>
        <SquareTerminal size={20} color={colors.muted} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={type.row} numberOfLines={1}>
          {tab.label}
        </Text>
        <Text style={type.sub}>Terminal</Text>
      </View>
    </PressableScale>
  );
}

function BlockedCard({
  agent,
  computer,
  client,
  prompt,
  onOpen,
  onMore,
}: {
  agent: AgentInfo;
  /** Its computer's name, when more than one is paired. */
  computer?: string;
  client: HostConnection | null;
  prompt: BlockedPrompt | undefined;
  onOpen: () => void;
  onMore: () => void;
}) {
  return (
    <View style={styles.card}>
      <PressableScale
        onPress={onOpen}
        onLongPress={onMore}
        highlight={false}
        style={styles.cardHeader}
        accessibilityRole="button"
        accessibilityLabel={`${agentTitle(agent) ?? agentName(agent)}, ${agentName(agent)}${computer ? ` on ${computer}` : ""}, needs input`}
        accessibilityHint="Opens the terminal. Long-press for more."
      >
        <AgentMark agent={agent.agent} size={28} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.row} numberOfLines={1}>
            {agentTitle(agent) ?? agentName(agent)}
          </Text>
          <Text style={type.sub} numberOfLines={1}>
            {[agentName(agent), projectOf(agent), computer].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <StatusIndicator status="blocked" />
      </PressableScale>
      {prompt ? (
        <PromptCard key={JSON.stringify(prompt)} client={client} paneId={agent.pane_id} prompt={prompt} />
      ) : client?.getState().status !== "online" ? (
        // The phone's copy from last time: the question can only be read, and answered, once connected.
        <Text style={type.sub}>Waiting for an answer when you last saw it. Reconnect to answer.</Text>
      ) : (
        <ActivityIndicator color={colors.muted} style={{ alignSelf: "flex-start" }} />
      )}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.lg, paddingTop: space.sm, height: 52 },
  hostChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.raised,
    borderRadius: radii.pill,
    paddingLeft: 12,
    paddingRight: 10,
    height: 34,
    maxWidth: 240,
  },
  hostDot: { width: 7, height: 7, borderRadius: 4 },
  computerHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.sm },
  computerNote: { fontSize: 13, color: colors.subtle, paddingHorizontal: space.lg, paddingBottom: space.sm },
  computerLoading: { alignSelf: "flex-start", marginHorizontal: space.lg, marginVertical: space.sm },
  spaceLabel: { fontSize: 13, fontWeight: "600", color: colors.muted, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: 2 },
  badge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.brand,
    borderWidth: 1.5,
    borderColor: colors.background,
  },
  hostName: { fontSize: 14, fontWeight: "600", color: colors.text, flexShrink: 1 },
  views: { flexDirection: "row", gap: space.lg },
  terminalMark: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  titleBlock: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 11 },
  statusSlot: { width: 24, alignItems: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  subagents: { flexDirection: "row", alignItems: "center", gap: 3 },
  subagentsText: { fontSize: 12, color: colors.muted, fontVariant: ["tabular-nums"] },
  lastDone: { fontSize: 12, color: colors.subtle },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 14, gap: space.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: space.md },
  empty: { alignItems: "center", gap: 6, paddingHorizontal: space.xl, paddingTop: 80 },
}));
