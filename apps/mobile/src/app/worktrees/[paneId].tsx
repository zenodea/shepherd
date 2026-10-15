import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronRight, GitBranch } from "lucide-react-native";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { agentName, agentTitle } from "../../agents/agents";
import { worktreesOf } from "../../agents/worktrees";
import { useHostState } from "../../connection/connection";
import { AgentMark } from "../../ui/AgentMark";
import { PressableScale } from "../../ui/Pressable";
import { Screen, ScreenHeader } from "../../ui/Screen";
import { colors, space, statusColors, statusLabels, statusRank, themed } from "../../ui/theme";

/** The agents in worktrees of an agent's repo, which the home screen lists under it. */
export default function WorktreesScreen() {
  const router = useRouter();
  const { paneId } = useLocalSearchParams<{ paneId: string }>();
  const state = useHostState();
  const agent = state.agents.find((a) => a.pane_id === paneId) ?? null;
  const worktrees = agent
    ? [...worktreesOf(agent, state.agents)].sort((a, b) => statusRank[a.agent_status] - statusRank[b.agent_status] || a.pane_id.localeCompare(b.pane_id))
    : [];
  const running = worktrees.filter((a) => a.agent_status === "working").length;

  return (
    <Screen>
      <ScreenHeader
        title="Worktrees"
        meta={[agent ? agentName(agent) : null, worktrees.length ? `${worktrees.length} in this repo` : null, running ? `${running} running` : null]
          .filter(Boolean)
          .join(" · ")}
      />
      {worktrees.length === 0 ? (
        <View style={styles.emptyBox}>
          <GitBranch size={28} color={colors.subtle} />
          <Text style={styles.empty}>No agents in worktrees of this repo.</Text>
        </View>
      ) : (
        <FlatList
          data={worktrees}
          keyExtractor={(a) => a.pane_id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const title = agentTitle(item) ?? agentName(item);
            const details = [agentName(item), statusLabels[item.agent_status], item.git?.branch].filter(Boolean);
            return (
              <PressableScale
                onPress={() => router.push({ pathname: "/agent/[paneId]", params: { paneId: item.pane_id } })}
                style={styles.card}
                accessibilityRole="button"
                accessibilityLabel={`${title}, ${details.join(", ")}`}
              >
                <AgentMark agent={item.agent} size={22} />
                <View style={styles.body}>
                  <Text style={styles.name} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={styles.details} numberOfLines={1}>
                    <Text style={{ color: item.agent_status === "idle" ? colors.subtle : statusColors[item.agent_status] }}>● </Text>
                    {details.join("  ·  ")}
                  </Text>
                </View>
                <ChevronRight size={16} color={colors.subtle} />
              </PressableScale>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    list: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.sm,
      paddingHorizontal: space.md,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    body: { flex: 1, gap: 2 },
    name: { fontSize: 14, fontWeight: "600", color: colors.text },
    details: { fontSize: 12, color: colors.muted },
    emptyBox: { alignItems: "center", gap: space.md, marginTop: space.xxl },
    empty: { fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: "center", padding: space.lg },
  }),
);
