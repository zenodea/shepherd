import { Check } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { choiceId, type ModelResult, type SetModelParams } from "@shepherd/protocol";
import type { HostConnection } from "../connection/host-client";
import { PressableScale } from "../ui/Pressable";
import { Sheet } from "../ui/Sheet";
import { Select } from "../ui/Select";
import { StepSlider } from "../ui/StepSlider";
import { colors, space, type, themed } from "../ui/theme";

/** More providers than this get a dropdown instead of a one-line slider. */
const MAX_SLIDER_GROUPS = 4;
/** Lists longer than this get a search field. */
const SEARCH_FROM = 12;

type Loaded = Extract<ModelResult, { available: true }>;

/** Short enough for every level to fit on one line. */
const SHORT: Record<string, string> = { xhigh: "X-High", "extra high": "X-High", minimal: "Min" };
/** Six or more levels: shorter still. */
const SHORTER: Record<string, string> = { ...SHORT, medium: "Med" };
const effortName = (label: string, count: number) =>
  (count > 5 ? SHORTER : SHORT)[label.toLowerCase()] ?? label.charAt(0).toUpperCase() + label.slice(1);

/**
 * The agent's model and effort, switched for this session through the agent's
 * own menus. The host reads them the first time, which takes a moment.
 */
export function ModelSheet({ client, paneId, name, visible, onClose }: { client: HostConnection | null; paneId: string; name: string; visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState<ModelResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!visible || !client) return;
    let cancelled = false;
    client
      .call<ModelResult>("shepherd.model", { paneId }, { timeoutMs: 30_000 })
      .then((result) => {
        if (cancelled) return;
        setMenu(result);
        setError(null);
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [visible, client, paneId]);

  const change = async (key: string, params: Omit<SetModelParams, "paneId">) => {
    if (!client || pending) return;
    setPending(key);
    setError(null);
    try {
      setMenu(await client.call<ModelResult>("shepherd.set_model", { paneId, ...params }, { timeoutMs: 30_000 }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const loaded: Loaded | null = menu?.available ? menu : null;
  const pendingEffort = pending?.startsWith("effort:") ? pending.slice("effort:".length) : null;
  const current = loaded?.models.find((m) => choiceId(m) === loaded.model);
  const groups = [...new Set((loaded?.models ?? []).flatMap((m) => (m.group ? [m.group] : [])))];
  const shownGroup = group ?? current?.group ?? groups[0] ?? null;
  const inGroup = (loaded?.models ?? []).filter((m) => groups.length < 2 || m.group === shownGroup);
  const needle = search.trim().toLowerCase();
  const shown = needle ? inGroup.filter((m) => m.label.toLowerCase().includes(needle)) : inGroup;

  return (
    <Sheet visible={visible} onClose={onClose} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
      <View style={styles.grabber} />
      <Text style={[type.sub, styles.title]}>{name} · changes apply to this session only</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {menu && !menu.available ? <Text style={styles.note}>{menu.reason}</Text> : null}
      {!menu && !error ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.muted} />
          <Text style={type.sub}>Reading {name}&apos;s models…</Text>
        </View>
      ) : null}
      {loaded ? (
        <ScrollView style={styles.list}>
          {loaded.efforts.length && !current?.noEffort ? <Text style={styles.label}>Effort</Text> : null}
          {loaded.efforts.length && !current?.noEffort ? (
            <View style={styles.efforts}>
              <StepSlider
                label="Effort"
                steps={loaded.efforts.map((e) => ({ key: e.label, label: effortName(e.label, loaded.efforts.length) }))}
                value={pendingEffort ?? loaded.effort}
                busy={pendingEffort !== null}
                onChange={(effort) => void change(`effort:${effort}`, { effort })}
              />
            </View>
          ) : null}
          {groups.length > 1 ? <Text style={styles.label}>Provider</Text> : null}
          {groups.length > 1 && groups.length <= MAX_SLIDER_GROUPS ? (
            <View style={styles.efforts}>
              <StepSlider label="Provider" steps={groups.map((g) => ({ key: g, label: g }))} value={shownGroup} onChange={setGroup} />
            </View>
          ) : null}
          {groups.length > MAX_SLIDER_GROUPS ? <Select title="Provider" value={shownGroup} options={groups.map((g) => ({ value: g, label: g }))} onChange={setGroup} /> : null}
          <Text style={styles.label}>Model</Text>
          {inGroup.length > SEARCH_FROM ? (
            <TextInput
              style={styles.search}
              value={search}
              onChangeText={setSearch}
              placeholder={`Search ${inGroup.length} models`}
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : null}
          {shown.map((m) => {
            const id = choiceId(m);
            const on = id === loaded.model;
            return (
              <PressableScale
                key={id}
                onPress={() => !on && void change(`model:${id}`, { model: id })}
                style={styles.option}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={type.row}>{m.label}</Text>
                  {m.detail ? (
                    <Text style={type.sub} numberOfLines={1}>
                      {m.detail}
                    </Text>
                  ) : null}
                </View>
                {pending === `model:${id}` ? <ActivityIndicator size="small" color={colors.muted} /> : on ? <Check size={18} color={colors.text} /> : null}
              </PressableScale>
            );
          })}
        </ScrollView>
      ) : null}
    </Sheet>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    sheet: { paddingHorizontal: space.md, paddingTop: space.sm, gap: 4 },
    grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: space.sm },
    title: { paddingHorizontal: space.sm, paddingBottom: space.xs },
    list: { flexShrink: 1 },
    loading: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md },
    note: { ...type.sub, padding: space.md },
    error: { color: colors.danger, fontSize: 13.5, paddingHorizontal: space.sm, paddingBottom: space.xs },
    label: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase", color: colors.subtle, paddingHorizontal: space.sm, paddingTop: space.sm },
    efforts: { paddingHorizontal: space.sm, paddingVertical: space.sm },
    search: { backgroundColor: colors.raised, borderRadius: 12, color: colors.text, fontSize: 15, paddingHorizontal: 12, paddingVertical: 10, marginHorizontal: space.sm, marginTop: space.sm },
    option: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: 14 },
  }),
);
