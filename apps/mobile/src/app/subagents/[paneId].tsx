import { useLocalSearchParams, useRouter } from "expo-router";
import { Bot } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import type { SubagentsResult } from "@shepherd/protocol";
import { agentName } from "../../agents/agents";
import { SubagentRow } from "../../agents/SubagentCard";
import { sortSubagents } from "../../agents/subagents";
import { useConnection, useHostState } from "../../connection/connection";
import { Screen, ScreenHeader } from "../../ui/Screen";
import { colors, space, themed } from "../../ui/theme";

const POLL_MS = 2000;

export default function SubagentsScreen() {
  const router = useRouter();
  const { paneId } = useLocalSearchParams<{ paneId: string }>();
  const { client } = useConnection();
  const state = useHostState();
  const agent = state.agents.find((a) => a.pane_id === paneId) ?? null;
  const [result, setResult] = useState<SubagentsResult | null>(null);

  useEffect(() => {
    if (!client || !paneId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current = true;
    const poll = () =>
      client
        .call<SubagentsResult>("shepherd.subagents", { paneId })
        .then((r) => current && setResult(r))
        .catch(() => {})
        .finally(() => {
          if (current) timer = setTimeout(poll, POLL_MS);
        });
    void poll();
    return () => {
      current = false;
      if (timer) clearTimeout(timer);
    };
  }, [client, paneId]);

  const subagents = result?.available ? sortSubagents(result.subagents) : [];
  const running = subagents.filter((s) => s.status === "running").length;

  return (
    <Screen>
      <ScreenHeader
        title="Subagents"
        meta={[agent ? agentName(agent) : null, subagents.length ? `${subagents.length} in this conversation` : null, running ? `${running} running` : null]
          .filter(Boolean)
          .join(" · ")}
      />
      {!result ? (
        <ActivityIndicator style={styles.loading} color={colors.subtle} />
      ) : !result.available ? (
        <Text style={styles.empty}>{result.reason}</Text>
      ) : subagents.length === 0 ? (
        <View style={styles.emptyBox}>
          <Bot size={28} color={colors.subtle} />
          <Text style={styles.empty}>No subagents in this conversation yet.</Text>
        </View>
      ) : (
        <FlatList
          data={subagents}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <SubagentRow
              subagent={item}
              indent={item.depth - 1}
              onPress={() => router.push({ pathname: "/subagent/[paneId]/[id]", params: { paneId: paneId!, id: item.id } })}
            />
          )}
        />
      )}
    </Screen>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    list: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm },
    loading: { marginTop: space.xxl },
    emptyBox: { alignItems: "center", gap: space.md, marginTop: space.xxl },
    empty: { fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: "center", padding: space.lg },
  }),
);
