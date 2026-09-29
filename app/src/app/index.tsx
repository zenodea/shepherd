import { Link, Redirect, Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { AgentInfo } from "@sheperd/protocol";
import { PromptCard } from "../components/PromptCard";
import { StatusBadge } from "../components/StatusBadge";
import { agentName, agentTitle, shortPath } from "../lib/agents";
import { useConnection, useHostState } from "../lib/connection";
import type { HostClient } from "../lib/host-client";
import type { BlockedPrompt } from "../lib/prompt-options";
import { useBlockedPrompts } from "../lib/use-blocked-prompts";
import { statusRank, usePalette } from "../theme";

export default function AgentsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { settings, client } = useConnection();
  const state = useHostState();
  const [refreshing, setRefreshing] = useState(false);
  const prompts = useBlockedPrompts(client, state.agents);

  const agents = useMemo(
    () =>
      [...state.agents].sort(
        (a, b) => statusRank[a.agent_status] - statusRank[b.agent_status] || a.pane_id.localeCompare(b.pane_id),
      ),
    [state.agents],
  );

  if (settings === undefined) return <ActivityIndicator style={{ marginTop: 32 }} />;
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

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: state.host?.name ?? "Agents",
          headerRight: () => (
            <View style={styles.headerButtons}>
              {state.status === "online" ? (
                <Link href="/new" style={{ color: palette.accent, fontSize: 15, fontWeight: "600" }}>
                  + New
                </Link>
              ) : null}
              <Link href="/connect" style={{ color: palette.accent, fontSize: 15 }}>
                Host
              </Link>
            </View>
          ),
        }}
      />
      <ConnectionBanner />
      <FlatList
        data={agents}
        keyExtractor={(a) => a.pane_id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={
          state.status === "online" ? (
            <View style={styles.emptyBox}>
              <Text style={[styles.empty, { color: palette.muted }]}>No agents running in herdr.</Text>
              <Link href="/new" style={{ color: palette.accent, fontSize: 16, fontWeight: "600" }}>
                Start one
              </Link>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <AgentRow
            agent={item}
            client={client}
            prompt={prompts[item.pane_id]}
            onPress={() => router.push({ pathname: "/agent/[paneId]", params: { paneId: item.pane_id } })}
          />
        )}
      />
    </View>
  );
}

function AgentRow({
  agent,
  client,
  prompt,
  onPress,
}: {
  agent: AgentInfo;
  client: HostClient | null;
  prompt: BlockedPrompt | undefined;
  onPress: () => void;
}) {
  const palette = usePalette();
  const title = agentTitle(agent);
  const path = shortPath(agent.foreground_cwd ?? agent.cwd);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={styles.rowHeader}>
        <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
          {agentName(agent)}
        </Text>
        <StatusBadge status={agent.agent_status} />
      </View>
      {title ? (
        <Text style={{ color: palette.text }} numberOfLines={2}>
          {title}
        </Text>
      ) : null}
      <Text style={[styles.meta, { color: palette.muted }]} numberOfLines={1}>
        {agent.pane_id}
        {path ? `  ·  ${path}` : ""}
      </Text>
      {agent.agent_status === "blocked" && prompt ? (
        <PromptCard
          key={JSON.stringify(prompt)}
          client={client}
          paneId={agent.pane_id}
          prompt={prompt}
        />
      ) : null}
    </Pressable>
  );
}

function ConnectionBanner() {
  const palette = usePalette();
  const state = useHostState();
  if (state.status === "online") return null;
  const text =
    state.status === "unauthorized"
      ? "Token rejected. Tap Host to update it."
      : state.status === "connecting"
        ? "Connecting…"
        : `Offline, retrying${state.error ? ` (${state.error})` : ""}`;
  return (
    <View style={[styles.banner, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={{ color: state.status === "unauthorized" ? palette.danger : palette.muted }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 6 },
  rowHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
  meta: { fontSize: 12 },
  empty: { textAlign: "center" },
  emptyBox: { alignItems: "center", gap: 12, marginTop: 32 },
  headerButtons: { flexDirection: "row", gap: 18, alignItems: "center" },
  banner: { borderBottomWidth: 1, paddingHorizontal: 16, paddingVertical: 8 },
});
