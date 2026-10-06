import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Card, CardButton, CardsResult, PluginActionResult, PluginPaneResult, PluginsResult, PluginSummary } from "@shepherd/protocol";
import { agentName } from "../../agents/agents";
import { CardView, Chips, buttonKey, describeError } from "../../agents/PluginCard";
import { useConnection, useHostState } from "../../connection/connection";
import { Button } from "../../ui/Button";
import { Screen, ScreenHeader } from "../../ui/Screen";
import { colors, space, themed, type } from "../../ui/theme";

const POLL_MS = 5000;

export default function PluginScreen() {
  const { id, paneId } = useLocalSearchParams<{ id: string; paneId?: string }>();
  const router = useRouter();
  const { client } = useConnection();
  const state = useHostState();
  const online = state.status === "online";
  const agent = paneId ? state.agents.find((a) => a.pane_id === paneId) ?? null : null;
  const [plugin, setPlugin] = useState<PluginSummary | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      if (!client) return;
      try {
        const [result, list] = await Promise.all([
          client.call<CardsResult>("shepherd.cards", { ...(paneId ? { paneId } : {}), refresh }, { timeoutMs: 70_000 }),
          client.call<PluginsResult>("shepherd.plugins"),
        ]);
        setCards(result.cards.filter((c) => c.plugin === id));
        setPlugin(list.plugins.find((p) => p.id === id) ?? null);
        setError(null);
      } catch (err) {
        setError(describeError(err));
      }
    },
    [client, id, paneId],
  );

  useEffect(() => {
    if (!online) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = () =>
      void load(false).finally(() => {
        if (current) timer = setTimeout(poll, POLL_MS);
      });
    poll();
    return () => {
      current = false;
      if (timer) clearTimeout(timer);
    };
  }, [load, online]);

  const pull = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  const run = async (card: Card, button: CardButton) => {
    if (!client) return;
    const key = buttonKey(card, button);
    setBusy(key);
    try {
      if (button.pane) {
        const opened = await client.call<PluginPaneResult>("shepherd.plugin_pane", { plugin: card.plugin, pane: button.pane, ...(paneId ? { paneId } : {}) });
        router.push({ pathname: "/agent/[paneId]", params: { paneId: opened.paneId } });
        return;
      }
      const result = await client.call<PluginActionResult>(
        "shepherd.plugin_action",
        { plugin: card.plugin, action: button.action, ...(paneId ? { paneId } : {}) },
        { timeoutMs: 30_000 },
      );
      if (result.status === "failed") Alert.alert(`${button.label} failed`, result.error ?? "The action reported an error.");
      else if (result.status === "running") Alert.alert(button.label, "Still running on your computer. Check herdr's plugin log if it doesn't finish.");
      else if (result.output) Alert.alert(button.label, result.output);
      await load(true);
    } catch (err) {
      Alert.alert(`Couldn't run ${button.label}`, describeError(err));
    } finally {
      setBusy(null);
    }
  };

  const press = (card: Card, button: CardButton) => {
    if (!button.confirm) return void run(card, button);
    Alert.alert(button.label, button.confirm, [
      { text: "Cancel", style: "cancel" },
      { text: button.label, style: button.tone === "bad" ? "destructive" : "default", onPress: () => void run(card, button) },
    ]);
  };

  const actions = cards?.find((c) => c.id === "actions") ?? null;
  const shown = cards?.filter((c) => c.id !== "actions") ?? [];

  return (
    <Screen>
      <ScreenHeader title={plugin?.name ?? id} meta={agent ? agentName(agent) : paneId ? "This pane" : "This computer"} />
      <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pull()} tintColor={colors.muted} />}>
        {error ? (
          <View style={styles.empty}>
            <Text style={type.title}>{"Can't show this plugin"}</Text>
            <Text style={[type.sub, { textAlign: "center" }]}>{error}</Text>
            <Button title="Try again" variant="secondary" onPress={() => void pull()} style={{ marginTop: space.md }} />
          </View>
        ) : cards === null ? (
          <ActivityIndicator style={styles.loading} color={colors.subtle} />
        ) : (
          <>
            {plugin?.description ? <Text style={styles.description}>{plugin.description}</Text> : null}
            {plugin?.sidecarError ? <Text style={[styles.description, { color: colors.danger }]}>{plugin.sidecarError}</Text> : null}
            {shown.map((card) => (
              <CardView key={card.id} card={card} busy={busy} onButton={press} />
            ))}
            {actions ? <Chips card={actions} busy={busy} onButton={press} /> : null}
            {shown.length === 0 && !actions ? <Text style={[type.sub, { textAlign: "center", paddingTop: space.xl }]}>Nothing to show here.</Text> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    list: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xxl, gap: space.md },
    description: { ...type.sub, fontSize: 13.5, lineHeight: 19, paddingHorizontal: 2, paddingBottom: space.xs },
    loading: { marginTop: space.xxl },
    empty: { alignItems: "center", gap: 6, paddingHorizontal: space.xl, paddingTop: 80 },
  }),
);
