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
import { useConnection, useHostState } from "../connection/connection";
import type { HostConnection } from "../connection/host-client";
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

export default function AgentsScreen() {
  // For "Last done: 12m ago" on each agent.
  const now = useNow(30_000);
  const router = useRouter();
  const { settings, hosts, client, switchTo } = useConnection();
  const state = useHostState();
  const [refreshing, setRefreshing] = useState(false);
  const [hostSheet, setHostSheet] = useState(false);
  const prompts = useBlockedPrompts(client, state.agents);
  const activity = useActivity(client, settings?.id ?? null, state.status === "online");
  const actions = useAgentActions(client);
  const showSpaces = spacesView.use();
  const snapshot = useSnapshot(client, showSpaces && state.status === "online");
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
      await client?.call("agent.list");
    } catch {
      // the banner shows connection problems
    } finally {
      setRefreshing(false);
    }
  };

  const online = state.status === "online";
  const hostName = state.host?.name ?? settings.name ?? "Host";
  const working = state.agents.filter((a) => a.agent_status === "working").length;
  const open = (agent: AgentInfo) => router.push({ pathname: "/agent/[paneId]", params: { paneId: agent.pane_id } });

  return (
    <Screen>
      <View style={styles.header}>
        <PressableScale
          onPress={() => setHostSheet(true)}
          style={styles.hostChip}
          accessibilityRole="button"
          accessibilityLabel={`${hostName}, ${statusText(state.status)}. Switch computer`}
        >
          <View style={[styles.hostDot, { backgroundColor: online ? statusColors.done : state.status === "connecting" ? colors.subtle : colors.danger }]} />
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
        {online ? (
          <Text style={type.sub}>
            {summary(state.agents.length, working, blocked.length)}
          </Text>
        ) : null}
      </View>

      <ConnectionBanner pairHint="Tap the host name to pair." />

      <ScrollView
        contentContainerStyle={{ paddingBottom: space.xxl * 2 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
      >
        {showSpaces ? (
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

        {!showSpaces && blocked.length > 0 ? (
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

        {showSpaces ? null : groups.map(([project, agents]) => (
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

        {online && (showSpaces ? spaces?.length === 0 : state.agents.length === 0) ? (
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
              detail: active ? statusText(state.status) : "Switch to this computer",
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

function statusText(status: string): string {
  if (status === "online") return "Connected";
  if (status === "connecting") return "Connecting…";
  if (status === "unauthorized") return "Not paired";
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

function AgentRow({ agent, now, onPress, onLongPress }: { agent: AgentInfo; now: number; onPress: () => void; onLongPress: () => void }) {
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
            {`  ·  ${agentName(agent)}`}
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
  client,
  prompt,
  onOpen,
  onMore,
}: {
  agent: AgentInfo;
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
        accessibilityLabel={`${agentTitle(agent) ?? agentName(agent)}, ${agentName(agent)}, needs input`}
        accessibilityHint="Opens the terminal. Long-press for more."
      >
        <AgentMark agent={agent.agent} size={28} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.row} numberOfLines={1}>
            {agentTitle(agent) ?? agentName(agent)}
          </Text>
          <Text style={type.sub} numberOfLines={1}>
            {agentName(agent)} · {projectOf(agent)}
          </Text>
        </View>
        <StatusIndicator status="blocked" />
      </PressableScale>
      {prompt ? (
        <PromptCard key={JSON.stringify(prompt)} client={client} paneId={agent.pane_id} prompt={prompt} />
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
