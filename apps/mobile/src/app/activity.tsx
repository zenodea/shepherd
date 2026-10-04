import { useRouter } from "expo-router";
import { RotateCcw, SquareTerminal } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { SectionList, StyleSheet, Text, View } from "react-native";
import type { ActivityEntry } from "@shepherd/protocol";
import { awaySummary, durations, entryVerb, groupByDay, timeLabel } from "../agents/activity";
import { projectOfPath } from "../agents/agents";
import { useActivity } from "../agents/use-activity";
import { useConnection, useHostState } from "../connection/connection";
import { ActionSheet } from "../ui/ActionSheet";
import { AgentMark } from "../ui/AgentMark";
import { PressableScale } from "../ui/Pressable";
import { Screen, ScreenHeader } from "../ui/Screen";
import { colors, radii, space, statusColors, type, themed } from "../ui/theme";

const eventColor = (event: ActivityEntry["event"]): string | undefined =>
  event === "blocked" || event === "done" || event === "working" ? statusColors[event] : undefined;

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
  // A closed agent can't be opened; offer to start it again where it was.
  const [gone, setGone] = useState<ActivityEntry | null>(null);
  const [goneOpen, setGoneOpen] = useState(false);
  const goneProject = gone ? projectOfPath(gone.cwd, gone.workspaceId) : "";

  return (
    <Screen>
      <ScreenHeader title="Activity" />
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
            live={live.has(item.paneId)}
            onPress={() => {
              if (live.has(item.paneId)) router.push({ pathname: "/agent/[paneId]", params: { paneId: item.paneId } });
              else {
                setGone(item);
                setGoneOpen(true);
              }
            }}
          />
        )}
      />
      <ActionSheet
        visible={goneOpen}
        title={gone ? `${gone.name || gone.agent || "This agent"} has closed` : undefined}
        onClose={() => setGoneOpen(false)}
        actions={
          gone
            ? [
                ...(gone.agent
                  ? [
                      {
                        icon: <RotateCcw size={19} color={colors.text} />,
                        title: `Start ${gone.agent} again`,
                        detail: `A new ${gone.agent} in ${goneProject}`,
                        onPress: () => router.push({ pathname: "/new", params: { workspace: gone.workspaceId, kind: gone.agent! } }),
                      },
                    ]
                  : []),
                {
                  icon: <SquareTerminal size={19} color={colors.text} />,
                  title: "Open a terminal there",
                  detail: goneProject,
                  onPress: () => router.push({ pathname: "/new", params: { workspace: gone.workspaceId, kind: "terminal" } }),
                },
              ]
            : []
        }
      />
    </Screen>
  );
}

function Row({ entry, took, unseen, live, onPress }: { entry: ActivityEntry; took: string | undefined; unseen: boolean; live: boolean; onPress: () => void }) {
  const who = entry.name || entry.agent || "Agent";
  const color = eventColor(entry.event) ?? colors.subtle;
  const where = [entry.title, projectOfPath(entry.cwd, entry.workspaceId)].filter(Boolean).join("  ·  ");
  const body = (
    <View style={[styles.row, !live && styles.gone]}>
      <View>
        <AgentMark agent={entry.agent} size={32} />
        <View style={[styles.eventDot, { backgroundColor: color }]} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={type.row} numberOfLines={1}>
          {who} <Text style={{ color: eventColor(entry.event) ?? colors.muted }}>{entryVerb(entry)}</Text>
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
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${who} ${entryVerb(entry)}, ${where}, ${timeLabel(entry.at)}${took ? `, ${took}` : ""}${live ? "" : ", closed"}`}
    >
      {body}
    </PressableScale>
  );
}

const styles = themed(() => StyleSheet.create({
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
}));
