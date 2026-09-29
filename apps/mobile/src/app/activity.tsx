import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { SectionList, StyleSheet, Text, View } from "react-native";
import type { ActivityEntry } from "@sheperd/protocol";
import { awaySummary, durations, entryVerb, groupByDay, timeLabel } from "../agents/activity";
import { projectOfPath } from "../agents/agents";
import { useActivity } from "../agents/use-activity";
import { useConnection, useHostState } from "../connection/connection";
import { AgentMark } from "../ui/AgentMark";
import { IconButton } from "../ui/IconButton";
import { PressableScale } from "../ui/Pressable";
import { Screen } from "../ui/Screen";
import { colors, radii, space, statusColors, type } from "../ui/theme";

const EVENT_COLORS: Partial<Record<ActivityEntry["event"], string>> = {
  blocked: statusColors.blocked,
  done: statusColors.done,
  working: statusColors.working,
};

export default function ActivityScreen() {
  const router = useRouter();
  const { client, settings } = useConnection();
  const state = useHostState();
  const online = state.status === "online";
  const activity = useActivity(client, settings?.id ?? null, online);
  const { entries, loaded, seenId, markSeen } = activity;

  // What was new when you opened this, kept while you look (everything here counts as seen).
  const [since, setSince] = useState<number | null>(null);
  if (since === null && loaded && entries.length > 0) setSince(seenId);
  useEffect(() => {
    if (since !== null) markSeen();
  }, [since, markSeen]);

  const sections = useMemo(() => groupByDay(entries).map((g) => ({ title: g.day, data: g.entries })), [entries]);
  const took = useMemo(() => durations(entries), [entries]);
  const summary = since !== null && since > 0 ? awaySummary(entries, since) : null;
  const live = new Set(state.agents.map((a) => a.pane_id));

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
          <ChevronLeft size={22} color={colors.text} />
        </IconButton>
        <Text style={styles.headerTitle}>Activity</Text>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(e) => String(e.id)}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: space.xxl * 2 }}
        onEndReached={() => void activity.loadMore()}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          summary ? (
            <View style={styles.summary}>
              <Text style={type.sub}>Since you last looked</Text>
              <Text style={type.row}>{summary}</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={type.title}>Nothing yet</Text>
            <Text style={[type.sub, { textAlign: "center" }]}>
              {online ? "When your agents start, finish or need you, it shows up here." : "Connect to your computer to see what your agents did."}
            </Text>
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={styles.day}>{section.title}</Text>}
        renderItem={({ item }) => (
          <Row
            entry={item}
            took={took.get(item.id)}
            unseen={since !== null && item.id > since}
            onPress={live.has(item.paneId) ? () => router.push({ pathname: "/agent/[paneId]", params: { paneId: item.paneId } }) : undefined}
          />
        )}
      />
    </Screen>
  );
}

function Row({ entry, took, unseen, onPress }: { entry: ActivityEntry; took: string | undefined; unseen: boolean; onPress?: () => void }) {
  const who = entry.name || entry.agent || "Agent";
  const color = EVENT_COLORS[entry.event] ?? colors.subtle;
  const where = [entry.title, projectOfPath(entry.cwd, entry.workspaceId)].filter(Boolean).join("  ·  ");
  const body = (
    <View style={[styles.row, !onPress && styles.gone]}>
      <View>
        <AgentMark agent={entry.agent} size={32} />
        <View style={[styles.eventDot, { backgroundColor: color }]} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={type.row} numberOfLines={1}>
          {who} <Text style={{ color: EVENT_COLORS[entry.event] ?? colors.muted }}>{entryVerb(entry)}</Text>
        </Text>
        <Text style={type.sub} numberOfLines={1}>
          {where}
        </Text>
      </View>
      <View style={styles.trailing}>
        <Text style={[type.caption, unseen && { color: colors.text }]}>{timeLabel(entry.at)}</Text>
        {took ? <Text style={type.caption}>{took}</Text> : null}
      </View>
    </View>
  );
  return onPress ? <PressableScale onPress={onPress}>{body}</PressableScale> : body;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  headerTitle: { fontSize: 17, fontWeight: "600", color: colors.text },
  summary: { marginHorizontal: space.lg, marginTop: space.sm, padding: 14, gap: 4, borderRadius: radii.lg, backgroundColor: colors.surface },
  day: { ...type.sub, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10 },
  gone: { opacity: 0.55 },
  eventDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.background,
  },
  trailing: { alignItems: "flex-end", gap: 3 },
  empty: { alignItems: "center", gap: 6, paddingHorizontal: space.xl, paddingTop: 80 },
});
