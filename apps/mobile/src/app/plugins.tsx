import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronRight, Puzzle } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import type { PluginsResult, PluginSummary } from "@shepherd/protocol";
import { agentName } from "../agents/agents";
import { PluginMark, describeError } from "../agents/PluginCard";
import { useConnection, useHostState } from "../connection/connection";
import { PressableScale } from "../ui/Pressable";
import { Screen, ScreenHeader } from "../ui/Screen";
import { colors, space, themed, type } from "../ui/theme";

function counts(plugin: PluginSummary): string {
  const parts = [plugin.cards.length ? `${plugin.cards.length} card${plugin.cards.length === 1 ? "" : "s"}` : "", plugin.actions.length ? `${plugin.actions.length} action${plugin.actions.length === 1 ? "" : "s"}` : ""];
  return parts.filter(Boolean).join(" · ");
}

export default function PluginsScreen() {
  const { paneId } = useLocalSearchParams<{ paneId?: string }>();
  const router = useRouter();
  const { client } = useConnection();
  const state = useHostState();
  const online = state.status === "online";
  const agent = paneId ? state.agents.find((a) => a.pane_id === paneId) ?? null : null;
  const [plugins, setPlugins] = useState<PluginSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !online) return;
    let current = true;
    client
      .call<PluginsResult>("shepherd.plugins")
      .then((r) => current && setPlugins(r.plugins))
      .catch((err: unknown) => current && setError(describeError(err)));
    return () => {
      current = false;
    };
  }, [client, online]);

  const open = (plugin: PluginSummary) => router.push({ pathname: "/plugin/[id]", params: { id: plugin.id, ...(paneId ? { paneId } : {}) } });

  return (
    <Screen>
      <ScreenHeader title="Plugins" meta={agent ? agentName(agent) : paneId ? "This pane" : "This computer"} />
      <ScrollView contentContainerStyle={styles.list}>
        {error ? (
          <View style={styles.empty}>
            <Text style={type.title}>{"Can't show plugins"}</Text>
            <Text style={[type.sub, { textAlign: "center" }]}>{error}</Text>
          </View>
        ) : plugins === null ? (
          <ActivityIndicator style={styles.loading} color={colors.subtle} />
        ) : plugins.length === 0 ? (
          <View style={styles.empty}>
            <Puzzle size={28} color={colors.subtle} />
            <Text style={type.title}>No plugins</Text>
            <Text style={[type.sub, { textAlign: "center" }]}>herdr plugins you install show up here on their own. Switch one off for phones in the Shepherd window on your computer.</Text>
          </View>
        ) : (
          plugins.map((plugin) => (
            <PressableScale key={plugin.id} onPress={() => open(plugin)} style={styles.row} accessibilityRole="button" accessibilityLabel={plugin.name}>
              <PluginMark size={32} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.row} numberOfLines={1}>
                  {plugin.name}
                </Text>
                <Text style={[type.sub, plugin.sidecarError ? { color: colors.danger } : null]} numberOfLines={2}>
                  {plugin.sidecarError ?? plugin.description ?? counts(plugin)}
                </Text>
              </View>
              <ChevronRight size={16} color={colors.subtle} />
            </PressableScale>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    list: { paddingTop: space.xs, paddingBottom: space.xxl },
    row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 11 },
    loading: { marginTop: space.xxl },
    empty: { alignItems: "center", gap: 6, paddingHorizontal: space.xl, paddingTop: 80 },
  }),
);
