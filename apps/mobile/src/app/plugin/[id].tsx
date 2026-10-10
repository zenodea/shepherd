import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Card, CardButton, CardsResult, PluginActionResult, PluginLogResult, PluginPaneResult, PluginRun, PluginSummary, PluginsResult } from "@shepherd/protocol";
import { agentName } from "../../agents/agents";
import { agoLabel, timeLabel } from "../../agents/activity";
import { CardView, Chips, buttonKey, describeError, type ChipItem } from "../../agents/PluginCard";
import { useConnection, useHostState } from "../../connection/connection";
import { Button } from "../../ui/Button";
import { PressableScale } from "../../ui/Pressable";
import { Screen, ScreenHeader } from "../../ui/Screen";
import { colors, space, statusColors, themed, type } from "../../ui/theme";

const POLL_MS = 5000;
const RUNS = 5;

function sourceLine(plugin: PluginSummary, now: number): string {
  const parts = [plugin.version];
  if (plugin.source.kind === "github") {
    parts.push(plugin.source.repo);
    if (plugin.source.installedAt) parts.push(`installed ${agoLabel(plugin.source.installedAt, now)}`);
  } else parts.push(`linked from ${plugin.source.path}`);
  return parts.join(" · ");
}

const runColor = (run: PluginRun) => (run.status === "failed" ? colors.danger : run.status === "running" ? statusColors.working : statusColors.done);

export default function PluginScreen() {
  const { id, paneId } = useLocalSearchParams<{ id: string; paneId?: string }>();
  const router = useRouter();
  const { client } = useConnection();
  const state = useHostState();
  const online = state.status === "online";
  const agent = paneId ? state.agents.find((a) => a.pane_id === paneId) ?? null : null;
  const [plugin, setPlugin] = useState<PluginSummary | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [runs, setRuns] = useState<PluginRun[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      if (!client) return;
      try {
        const [result, list, log] = await Promise.all([
          client.call<CardsResult>("shepherd.cards", { ...(paneId ? { paneId } : {}), refresh }, { timeoutMs: 70_000 }),
          client.call<PluginsResult>("shepherd.plugins"),
          client.call<PluginLogResult>("shepherd.plugin_log", { plugin: id, limit: RUNS }).catch(() => ({ runs: [] as PluginRun[] })),
        ]);
        setCards(result.cards.filter((c) => c.plugin === id));
        setPlugin(list.plugins.find((p) => p.id === id) ?? null);
        setRuns(log.runs);
        setNow(Date.now());
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

  const openPane = async (pane: string, key: string) => {
    if (!client) return;
    setBusy(key);
    try {
      const opened = await client.call<PluginPaneResult>("shepherd.plugin_pane", { plugin: id, pane, ...(paneId ? { paneId } : {}) });
      router.push({ pathname: "/agent/[paneId]", params: { paneId: opened.paneId } });
    } catch (err) {
      Alert.alert("Couldn't open it", describeError(err));
    } finally {
      setBusy(null);
    }
  };

  const invoke = async (action: string, label: string, key: string) => {
    if (!client) return;
    setBusy(key);
    try {
      const result = await client.call<PluginActionResult>("shepherd.plugin_action", { plugin: id, action, ...(paneId ? { paneId } : {}) }, { timeoutMs: 30_000 });
      if (result.status === "failed") Alert.alert(`${label} failed`, result.error ?? "The action reported an error.");
      else if (result.status === "running") Alert.alert(label, "Still running on your computer. Check herdr's plugin log if it doesn't finish.");
      else if (result.output) Alert.alert(label, result.output);
      await load(true);
    } catch (err) {
      Alert.alert(`Couldn't run ${label}`, describeError(err));
    } finally {
      setBusy(null);
    }
  };

  const confirmThen = (label: string, confirm: string | undefined, destructive: boolean, go: () => void) => {
    if (!confirm) return go();
    Alert.alert(label, confirm, [
      { text: "Cancel", style: "cancel" },
      { text: label, style: destructive ? "destructive" : "default", onPress: go },
    ]);
  };

  const onCardButton = (card: Card, button: CardButton) => {
    const key = buttonKey(card, button);
    const go = () => (button.pane ? void openPane(button.pane, key) : void invoke(button.action!, button.label, key));
    confirmThen(button.label, button.confirm, button.tone === "bad", go);
  };

  const shown = cards?.filter((c) => c.id !== "actions") ?? [];
  const actionIds = new Set<string>();
  const actionsCard = cards?.find((c) => c.id === "actions");
  if (actionsCard && "body" in actionsCard) for (const b of actionsCard.body.buttons) if (b.action) actionIds.add(b.action);
  const actions = (plugin?.actions ?? []).filter((a) => actionIds.has(a.id));
  const described = actions.some((a) => a.description);
  const actionChips: ChipItem[] = actions.map((a) => ({ key: `action:${a.id}`, label: a.title, onPress: () => void invoke(a.id, a.title, `action:${a.id}`) }));
  const paneChips: ChipItem[] = (plugin?.panes ?? []).map((p) => ({ key: `pane:${p.id}`, label: p.title, pane: true, onPress: () => void openPane(p.id, `pane:${p.id}`) }));

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
        ) : cards === null || !plugin ? (
          <ActivityIndicator style={styles.loading} color={colors.subtle} />
        ) : (
          <>
            <View style={styles.about}>
              {plugin.description ? <Text style={styles.description}>{plugin.description}</Text> : null}
              <Text style={type.caption}>{sourceLine(plugin, now)}</Text>
              {plugin.sidecarError ? <Text style={[styles.description, { color: colors.danger }]}>{plugin.sidecarError}</Text> : null}
            </View>

            {shown.map((card) => (
              <CardView key={card.id} card={card} busy={busy} onButton={onCardButton} now={now} />
            ))}

            {described ? (
              <View style={styles.rows}>
                {actions.map((a) => {
                  const key = `action:${a.id}`;
                  return (
                    <PressableScale key={a.id} onPress={() => void invoke(a.id, a.title, key)} disabled={busy !== null} style={[styles.actionRow, busy !== null && busy !== key && { opacity: 0.5 }]} accessibilityRole="button">
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={type.row}>{a.title}</Text>
                        {a.description ? <Text style={type.sub}>{a.description}</Text> : null}
                      </View>
                      {busy === key ? <ActivityIndicator size="small" color={colors.text} /> : null}
                    </PressableScale>
                  );
                })}
              </View>
            ) : (
              <Chips items={actionChips} busy={busy} />
            )}
            <Chips items={paneChips} busy={busy} />

            {runs.length ? (
              <View style={styles.recent}>
                <Text style={styles.recentTitle}>Recent</Text>
                {runs.map((run) => (
                  <View key={run.id} style={styles.run}>
                    <View style={[styles.runDot, { backgroundColor: runColor(run) }]} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={styles.runWhat} numberOfLines={1}>
                        {run.what}
                        <Text style={type.caption}>{`  ${run.status === "running" ? "running" : timeLabel(run.startedAt, now)}`}</Text>
                      </Text>
                      {run.error ? (
                        <Text style={[type.sub, { color: colors.danger }]} numberOfLines={2}>
                          {run.error}
                        </Text>
                      ) : run.output ? (
                        <Text style={type.sub} numberOfLines={2}>
                          {run.output}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {shown.length === 0 && actions.length === 0 && paneChips.length === 0 ? <Text style={[type.sub, { textAlign: "center", paddingTop: space.xl }]}>Nothing to show here.</Text> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    list: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xxl, gap: space.md },
    about: { gap: 4, paddingHorizontal: 2, paddingBottom: space.xs },
    description: { ...type.sub, fontSize: 13.5, lineHeight: 19 },
    rows: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, overflow: "hidden" },
    actionRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: 14, paddingVertical: 12 },
    recent: { gap: space.sm, paddingTop: space.sm },
    recentTitle: { fontSize: 13, fontWeight: "600", color: colors.muted, paddingHorizontal: 2 },
    run: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 2 },
    runDot: { width: 7, height: 7, borderRadius: 4, marginTop: 7 },
    runWhat: { fontSize: 14, fontWeight: "500", color: colors.text },
    loading: { marginTop: space.xxl },
    empty: { alignItems: "center", gap: 6, paddingHorizontal: space.xl, paddingTop: 80 },
  }),
);
