import { useLocalSearchParams, useRouter } from "expo-router";
import { AtSign, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChangedFile, ChangesMode, FileDiffResult } from "@shepherd/protocol";
import { Counts } from "../../agents/Counts";
import { DiffView } from "../../agents/DiffView";
import { appendToDraft } from "../../agents/drafts";
import { useChanges } from "../../agents/use-changes";
import { useConnection, useHostState } from "../../connection/connection";
import { IconButton } from "../../ui/IconButton";
import { PressableScale } from "../../ui/Pressable";
import { Screen } from "../../ui/Screen";
import { colors, fonts, space, themed } from "../../ui/theme";

const split = (path: string) => {
  const slash = path.lastIndexOf("/");
  return { name: path.slice(slash + 1), dir: slash > 0 ? path.slice(0, slash) : "" };
};

/** A tiny bar: how much of this file changed, in green and red. */
function Bar({ file }: { file: ChangedFile }) {
  const total = file.additions + file.deletions;
  const blocks = 5;
  const filled = Math.max(1, Math.min(blocks, Math.ceil(Math.log10(total + 1) * 2)));
  const green = total ? Math.round((file.additions / total) * filled) : 0;
  return (
    <View style={styles.bar}>
      {Array.from({ length: blocks }, (_, i) => (
        <View key={i} style={[styles.block, i < green ? styles.blockAdd : i < filled ? styles.blockDel : null]} />
      ))}
    </View>
  );
}

const LABEL: Partial<Record<ChangedFile["status"], string>> = { added: "new", deleted: "deleted", renamed: "renamed" };

function FileRow({ file, onPress }: { file: ChangedFile; onPress: () => void }) {
  const { name, dir } = split(file.path);
  return (
    <PressableScale onPress={onPress} style={styles.row} accessibilityRole="button" accessibilityLabel={`${file.path}, ${file.additions} added, ${file.deletions} removed`}>
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
          {LABEL[file.status] ? <Text style={styles.label}>{`  ${LABEL[file.status]}`}</Text> : null}
        </Text>
        {dir ? (
          <Text style={styles.dir} numberOfLines={1}>
            {dir}
          </Text>
        ) : null}
      </View>
      {file.binary ? <Text style={styles.dir}>binary</Text> : <Counts additions={file.additions} deletions={file.deletions} size={12.5} />}
      <Bar file={file} />
    </PressableScale>
  );
}

/** The list: every changed file, generated ones folded away. */
function ChangesList({ paneId, mode, onMode }: { paneId: string; mode?: ChangesMode; onMode: (mode: ChangesMode) => void }) {
  const router = useRouter();
  const { client } = useConnection();
  const state = useHostState();
  const agent = state.agents.find((a) => a.pane_id === paneId) ?? null;
  const { changes } = useChanges(client, paneId, state.status === "online", agent?.agent_status ?? null, mode);
  const [showGenerated, setShowGenerated] = useState(false);

  if (!changes) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.muted} />;
  if (!changes.available) return <Text style={styles.empty}>{changes.reason}</Text>;
  const files = changes.files.filter((f) => !f.generated);
  const generated = changes.files.filter((f) => f.generated);
  const count = changes.files.length + (changes.omitted ?? 0);
  const open = (file: ChangedFile) => router.push({ pathname: "/changes/[paneId]", params: { paneId, path: file.path, mode: changes.mode } });

  return (
    <FlatList
      data={showGenerated ? [...files, ...generated] : files}
      keyExtractor={(f) => f.path}
      renderItem={({ item }) => <FileRow file={item} onPress={() => open(item)} />}
      ListHeaderComponent={
        <View style={styles.summary}>
          {changes.canCompareBranch ? (
            <View style={styles.modes}>
              {(["uncommitted", "branch"] as const).map((m) => (
                <PressableScale
                  key={m}
                  onPress={() => onMode(m)}
                  style={[styles.mode, changes.mode === m && styles.modeOn]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: changes.mode === m }}
                >
                  <Text style={[styles.modeText, changes.mode === m && styles.modeTextOn]}>{m === "uncommitted" ? "Not committed" : "Whole branch"}</Text>
                </PressableScale>
              ))}
            </View>
          ) : null}
          <Text style={styles.summaryText}>
            {changes.mode === "branch" ? `${changes.branch} since it left ${changes.base}` : `Not committed yet${changes.branch ? ` · ${changes.branch}` : ""}`}
          </Text>
          <View style={styles.totals}>
            <Text style={styles.totalsText}>{`${count} file${count === 1 ? "" : "s"}  ·  `}</Text>
            <Counts additions={changes.additions} deletions={changes.deletions} size={13} />
          </View>
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>Nothing has changed.</Text>}
      ListFooterComponent={
        <View>
          {generated.length && !showGenerated ? (
            <PressableScale onPress={() => setShowGenerated(true)} style={styles.footerRow} accessibilityRole="button">
              <Text style={styles.dir}>{`${generated.length} generated file${generated.length === 1 ? "" : "s"} (lock files and the like)`}</Text>
            </PressableScale>
          ) : null}
          {changes.omitted ? <Text style={[styles.dir, styles.footerRow]}>{`+ ${changes.omitted} more files`}</Text> : null}
        </View>
      }
    />
  );
}

/** One file: its diff, the files around it, and mentioning it to the agent. */
function FileChanges({ paneId, path, mode }: { paneId: string; path: string; mode: ChangesMode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, settings } = useConnection();
  const state = useHostState();
  const agent = state.agents.find((a) => a.pane_id === paneId) ?? null;
  const online = state.status === "online";
  const { changes } = useChanges(client, paneId, online, agent?.agent_status ?? null, mode);
  const [diff, setDiff] = useState<{ path: string; result: FileDiffResult } | null>(null);

  useEffect(() => {
    if (!client || !online) return;
    let cancelled = false;
    client
      .call<FileDiffResult>("shepherd.file_diff", { paneId, path, mode })
      .then((result) => !cancelled && setDiff({ path, result }))
      .catch((err: Error) => !cancelled && setDiff({ path, result: { available: false, reason: err.message } }));
    return () => {
      cancelled = true;
    };
  }, [client, online, paneId, path, mode]);

  const files = useMemo(() => (changes?.available ? [...changes.files.filter((f) => !f.generated), ...changes.files.filter((f) => f.generated)] : []), [changes]);
  const index = files.findIndex((f) => f.path === path);
  const file = files[index] ?? null;
  const go = (step: number) => {
    const next = files[index + step];
    if (next) router.setParams({ path: next.path });
  };
  const mention = () => {
    if (!file) return;
    appendToDraft(`${settings?.id ?? "none"}:${paneId}`, `@${file.mention} `);
    router.dismissTo({ pathname: "/agent/[paneId]", params: { paneId } });
  };
  const current = diff?.path === path ? diff.result : null;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.diff}>
        {!current ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.muted} />
        ) : current.available ? (
          <DiffView diff={current.diff} />
        ) : (
          <Text style={styles.empty}>{current.reason}</Text>
        )}
      </ScrollView>
      <View style={[styles.fileBar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
        <IconButton label="Previous file" onPress={() => go(-1)} filled={false}>
          <ChevronLeft size={20} color={index > 0 ? colors.text : colors.subtle} />
        </IconButton>
        <PressableScale onPress={mention} disabled={!file} style={styles.mention} accessibilityRole="button" accessibilityLabel={`Mention ${file?.mention ?? "this file"} in your message`}>
          <AtSign size={15} color={colors.text} />
          <Text style={styles.mentionText}>Mention in message</Text>
        </PressableScale>
        <IconButton label="Next file" onPress={() => go(1)} filled={false}>
          <ChevronRight size={20} color={index >= 0 && index < files.length - 1 ? colors.text : colors.subtle} />
        </IconButton>
      </View>
    </View>
  );
}

/** What the agent changed: the list of files, or (with `path`) one file's diff. */
export default function ChangesScreen() {
  const router = useRouter();
  const { paneId, path, mode } = useLocalSearchParams<{ paneId: string; path?: string; mode?: ChangesMode }>();
  const [listMode, setListMode] = useState<ChangesMode | undefined>(undefined);
  const { name, dir } = split(path ?? "");
  return (
    <Screen>
      <View style={styles.header}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
          <ChevronLeft size={22} color={colors.text} />
        </IconButton>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {path ? name : "Changes"}
          </Text>
          {path && dir ? (
            <Text style={styles.dir} numberOfLines={1}>
              {dir}
            </Text>
          ) : null}
        </View>
      </View>
      {path ? <FileChanges paneId={paneId} path={path} mode={mode ?? "uncommitted"} /> : <ChangesList paneId={paneId} mode={listMode} onMode={setListMode} />}
    </Screen>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
    title: { fontSize: 16, fontWeight: "600", color: colors.text },
    summary: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: 6 },
    summaryText: { fontSize: 13, color: colors.muted },
    totals: { flexDirection: "row", alignItems: "center" },
    totalsText: { fontSize: 13, color: colors.text, fontWeight: "600" },
    modes: { flexDirection: "row", alignSelf: "flex-start", padding: 3, borderRadius: 999, backgroundColor: colors.raised, marginBottom: 6 },
    mode: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
    modeOn: { backgroundColor: colors.primary },
    modeText: { fontSize: 13, fontWeight: "600", color: colors.muted },
    modeTextOn: { color: colors.onPrimary },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: space.lg,
      paddingVertical: 11,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.hairline,
    },
    rowText: { flex: 1, gap: 2 },
    name: { fontSize: 15, fontWeight: "600", color: colors.text },
    label: { fontSize: 11.5, fontWeight: "500", color: colors.subtle },
    dir: { fontSize: 12.5, color: colors.subtle },
    bar: { flexDirection: "row", gap: 2 },
    block: { width: 6, height: 6, borderRadius: 1.5, backgroundColor: colors.border },
    blockAdd: { backgroundColor: "#4ADE80" },
    blockDel: { backgroundColor: "#F87171" },
    footerRow: { paddingHorizontal: space.lg, paddingVertical: 12 },
    empty: { fontSize: 14, color: colors.muted, textAlign: "center", marginTop: 40, paddingHorizontal: space.xl },
    diff: { padding: space.md, paddingBottom: space.xl },
    fileBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: space.md,
      paddingTop: space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.hairline,
      backgroundColor: colors.background,
    },
    mention: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.raised },
    mentionText: { fontSize: 13.5, fontWeight: "600", color: colors.text },
    rowFont: { fontFamily: fonts.mono },
  }),
);
