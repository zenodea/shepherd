import { useLocalSearchParams, useRouter } from "expo-router";
import { AtSign, Check, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChangedFile, ChangesMode, ChangesResult, FileDiffResult } from "@shepherd/protocol";
import { agentName } from "../../agents/agents";
import { Counts } from "../../agents/Counts";
import { lineRef, type DiffRow } from "../../agents/diff-rows";
import { DiffFoldRow, DiffHunkRow, DiffLineRow, DiffNote, useDiffRows } from "../../agents/DiffView";
import { appendToDraft } from "../../agents/drafts";
import { fingerprint, removeComment, saveComment, setViewed, useReview, viewedKey, type Review, type ReviewComment } from "../../agents/review";
import { CommentSheet, ReviewBar, SendReviewSheet, type CommentTarget } from "../../agents/ReviewSheets";
import { useChanges } from "../../agents/use-changes";
import { useConnection, useHostState } from "../../connection/connection";
import { IconButton } from "../../ui/IconButton";
import { PressableScale } from "../../ui/Pressable";
import { Screen, ScreenHeader } from "../../ui/Screen";
import { colors, fonts, radii, space, themed } from "../../ui/theme";

const split = (path: string) => {
  const slash = path.lastIndexOf("/");
  return { name: path.slice(slash + 1), dir: slash > 0 ? path.slice(0, slash) : "" };
};

const STATUS: Record<ChangedFile["status"], { letter: string; label: string; color: () => string }> = {
  added: { letter: "A", label: "new", color: () => "#4ADE80" },
  modified: { letter: "M", label: "changed", color: () => colors.syntaxNumber },
  deleted: { letter: "D", label: "deleted", color: () => "#F87171" },
  renamed: { letter: "R", label: "renamed", color: () => colors.linkText },
};

const isViewed = (review: Review, mode: ChangesMode, file: ChangedFile) => review.viewed[viewedKey(mode, file.path)] === fingerprint(file);

/** The files in review order: by folder, then name; generated ones last. */
function ordered(changes: Extract<ChangesResult, { available: true }>): ChangedFile[] {
  const byPlace = (a: ChangedFile, b: ChangedFile) => split(a.path).dir.localeCompare(split(b.path).dir) || a.path.localeCompare(b.path);
  return [...changes.files.filter((f) => !f.generated).sort(byPlace), ...changes.files.filter((f) => f.generated).sort(byPlace)];
}

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

function FileRow({ file, viewed, comments, onPress }: { file: ChangedFile; viewed: boolean; comments: number; onPress: () => void }) {
  const status = STATUS[file.status];
  return (
    <PressableScale
      onPress={onPress}
      style={styles.row}
      accessibilityLabel={`${file.path}, ${status.label}, ${file.additions} added, ${file.deletions} removed${viewed ? ", viewed" : ""}${comments ? `, ${comments} comments` : ""}`}
    >
      <Text style={[styles.letter, { color: status.color() }]}>{status.letter}</Text>
      <Text style={[styles.name, viewed && styles.viewedName]} numberOfLines={1}>
        {split(file.path).name}
      </Text>
      {comments ? <Text style={styles.commentCount}>{comments}</Text> : null}
      {viewed ? <Check size={14} color={colors.subtle} /> : null}
      {file.binary ? <Text style={styles.dir}>binary</Text> : <Counts additions={file.additions} deletions={file.deletions} size={12.5} />}
      <Bar file={file} />
    </PressableScale>
  );
}

/** The list: every changed file by folder, which ones you've viewed, and your review so far. */
function ChangesList({ paneId, mode, onMode }: { paneId: string; mode?: ChangesMode; onMode: (mode: ChangesMode) => void }) {
  const router = useRouter();
  const { client, settings } = useConnection();
  const state = useHostState();
  const agent = state.agents.find((a) => a.pane_id === paneId) ?? null;
  const { changes } = useChanges(client, paneId, state.status === "online", agent?.agent_status ?? null, mode);
  const reviewKey = `${settings?.id ?? "none"}:${paneId}`;
  const review = useReview(reviewKey);
  const [showGenerated, setShowGenerated] = useState(false);
  const [sending, setSending] = useState(false);

  const files = useMemo(() => (changes?.available ? ordered(changes) : []), [changes]);
  if (!changes) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.muted} />;
  if (!changes.available) return <Text style={styles.empty}>{changes.reason}</Text>;

  const shown = files.filter((f) => showGenerated || !f.generated);
  const generated = files.length - files.filter((f) => !f.generated).length;
  const sections = [...new Set(shown.map((f) => split(f.path).dir))].map((dir) => ({ dir, data: shown.filter((f) => split(f.path).dir === dir) }));
  const reviewable = files.filter((f) => !f.generated);
  const viewed = reviewable.filter((f) => isViewed(review, changes.mode, f)).length;
  const count = changes.files.length + (changes.omitted ?? 0);
  const open = (file: ChangedFile) => router.push({ pathname: "/changes/[paneId]", params: { paneId, path: file.path, mode: changes.mode } });

  return (
    <View style={{ flex: 1 }}>
      <SectionList
        sections={sections}
        keyExtractor={(f) => f.path}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <Text style={styles.folder}>{section.dir || "/"}</Text>}
        renderItem={({ item }) => (
          <FileRow file={item} viewed={isViewed(review, changes.mode, item)} comments={review.comments.filter((c) => c.path === item.path).length} onPress={() => open(item)} />
        )}
        ListHeaderComponent={
          <View style={styles.summary}>
            {changes.canCompareBranch ? (
              <View style={styles.modes}>
                {(["uncommitted", "branch"] as const).map((m) => (
                  <PressableScale key={m} onPress={() => onMode(m)} style={[styles.mode, changes.mode === m && styles.modeOn]} accessibilityRole="tab" accessibilityState={{ selected: changes.mode === m }}>
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
              {reviewable.length ? <Text style={styles.viewedText}>{`  ·  ${viewed} of ${reviewable.length} viewed`}</Text> : null}
            </View>
            {reviewable.length ? (
              <View style={styles.progress}>
                <View style={[styles.progressFill, { width: `${(viewed / reviewable.length) * 100}%` }]} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>Nothing has changed.</Text>}
        ListFooterComponent={
          <View style={{ paddingBottom: space.xxl }}>
            {generated && !showGenerated ? (
              <PressableScale onPress={() => setShowGenerated(true)} style={styles.footerRow}>
                <Text style={styles.dir}>{`${generated} generated file${generated === 1 ? "" : "s"} (lock files and the like)`}</Text>
              </PressableScale>
            ) : null}
            {changes.omitted ? <Text style={[styles.dir, styles.footerRow]}>{`+ ${changes.omitted} more files`}</Text> : null}
          </View>
        }
      />
      <ReviewBar count={review.comments.length} onPress={() => setSending(true)} />
      <SendReviewSheet
        visible={sending}
        client={client}
        paneId={paneId}
        reviewKey={reviewKey}
        agentName={agent ? agentName(agent) : "the agent"}
        comments={review.comments}
        onClose={() => setSending(false)}
      />
    </View>
  );
}

type Item = DiffRow | { kind: "comment"; key: string; comment: ReviewComment };

function CommentCard({ comment, onPress }: { comment: ReviewComment; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} style={styles.comment} accessibilityLabel={`Your comment: ${comment.text}. Tap to edit`}>
      <Text style={styles.commentText}>{comment.text}</Text>
    </PressableScale>
  );
}

/** One file to review: its whole diff, comments on its lines, and moving on once it's viewed. */
function FileChanges({ paneId, path, mode }: { paneId: string; path: string; mode: ChangesMode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, settings } = useConnection();
  const state = useHostState();
  const agent = state.agents.find((a) => a.pane_id === paneId) ?? null;
  const online = state.status === "online";
  const { changes } = useChanges(client, paneId, online, agent?.agent_status ?? null, mode);
  const reviewKey = `${settings?.id ?? "none"}:${paneId}`;
  const review = useReview(reviewKey);
  const [diff, setDiff] = useState<{ path: string; result: FileDiffResult } | null>(null);
  const [target, setTarget] = useState<CommentTarget | null>(null);
  const [sending, setSending] = useState(false);

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

  const current = diff?.path === path ? diff.result : null;
  const { rows, open } = useDiffRows(current?.available ? current.diff : null);
  const comments = useMemo(() => review.comments.filter((c) => c.path === path), [review.comments, path]);
  // Each line followed by the comments on it.
  const items = useMemo<Item[]>(
    () =>
      rows.flatMap((row): Item[] => {
        if (row.kind !== "line") return [row];
        const ref = lineRef(row.line);
        return [row, ...comments.filter((c) => c.side === ref.side && c.line === ref.number).map((comment) => ({ kind: "comment" as const, key: `c${comment.id}`, comment }))];
      }),
    [rows, comments],
  );

  const files = useMemo(() => (changes?.available ? ordered(changes) : []), [changes]);
  const index = files.findIndex((f) => f.path === path);
  const file = files[index] ?? null;
  const viewed = file ? isViewed(review, mode, file) : false;
  const go = (to: ChangedFile | undefined) => to && router.setParams({ path: to.path });
  const toggleViewed = () => {
    if (!file) return;
    setViewed(reviewKey, viewedKey(mode, file.path), viewed ? null : fingerprint(file));
    // Done with this one: on to the next file you haven't viewed.
    if (!viewed) go([...files.slice(index + 1), ...files.slice(0, index)].find((f) => !f.generated && !isViewed(review, mode, f)));
  };
  const mention = () => {
    if (!file) return;
    appendToDraft(reviewKey, `@${file.mention} `);
    router.dismissTo({ pathname: "/agent/[paneId]", params: { paneId } });
  };
  const commentOn = (row: Extract<DiffRow, { kind: "line" }>) => {
    const { side, number } = lineRef(row.line);
    setTarget({ path, side, line: number, code: row.line.text });
  };

  const note = current?.available ? DiffNote({ diff: current.diff }) : null;
  return (
    <View style={{ flex: 1 }}>
      {!current ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.muted} />
      ) : !current.available ? (
        <Text style={styles.empty}>{current.reason}</Text>
      ) : note ? (
        <View style={{ padding: space.md }}>{note}</View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.key}
          style={styles.diff}
          contentContainerStyle={{ paddingVertical: space.sm, paddingBottom: space.xxl }}
          initialNumToRender={60}
          windowSize={15}
          renderItem={({ item }) =>
            item.kind === "line" ? (
              <DiffLineRow row={item} numbers selected={target?.side === lineRef(item.line).side && target.line === lineRef(item.line).number} onPress={() => commentOn(item)} />
            ) : item.kind === "fold" ? (
              <DiffFoldRow count={item.count} onOpen={() => open(item.key)} />
            ) : item.kind === "hunk" ? (
              <DiffHunkRow line={item.line} />
            ) : (
              <CommentCard comment={item.comment} onPress={() => setTarget({ path, side: item.comment.side, line: item.comment.line, code: item.comment.code, comment: item.comment })} />
            )
          }
          ListFooterComponent={current.diff.truncated ? <Text style={styles.cut}>Cut short: the rest is too big to show here.</Text> : null}
        />
      )}
      <View style={[styles.fileBar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
        <ReviewBar count={review.comments.length} onPress={() => setSending(true)} />
        <View style={styles.fileBarRow}>
          <IconButton label="Previous file" onPress={() => go(files[index - 1])} filled={false}>
            <ChevronLeft size={20} color={index > 0 ? colors.text : colors.subtle} />
          </IconButton>
          <IconButton label={`Mention ${file?.mention ?? "this file"} in your message`} onPress={mention} filled={false}>
            <AtSign size={18} color={colors.text} />
          </IconButton>
          <PressableScale onPress={toggleViewed} disabled={!file} style={[styles.viewed, viewed && styles.viewedOn]} accessibilityRole="checkbox" accessibilityState={{ checked: viewed }}>
            {viewed ? <Check size={15} color={colors.onPrimary} /> : null}
            <Text style={[styles.viewedLabel, viewed && { color: colors.onPrimary }]}>{viewed ? "Viewed" : "Mark viewed"}</Text>
          </PressableScale>
          <Text style={styles.position}>{index >= 0 ? `${index + 1}/${files.length}` : ""}</Text>
          <IconButton label="Next file" onPress={() => go(files[index + 1])} filled={false}>
            <ChevronRight size={20} color={index >= 0 && index < files.length - 1 ? colors.text : colors.subtle} />
          </IconButton>
        </View>
      </View>
      <CommentSheet
        target={target}
        onSave={(text) => saveComment(reviewKey, { id: target?.comment?.id, path, side: target!.side, line: target!.line, code: target!.code, text })}
        onDelete={() => target?.comment && removeComment(reviewKey, target.comment.id)}
        onClose={() => setTarget(null)}
      />
      <SendReviewSheet
        visible={sending}
        client={client}
        paneId={paneId}
        reviewKey={reviewKey}
        agentName={agent ? agentName(agent) : "the agent"}
        comments={review.comments}
        onClose={() => setSending(false)}
      />
    </View>
  );
}

/** What the agent changed: the list of files, or (with `path`) one file to review. */
export default function ChangesScreen() {
  const { paneId, path, mode } = useLocalSearchParams<{ paneId: string; path?: string; mode?: ChangesMode }>();
  const [listMode, setListMode] = useState<ChangesMode | undefined>(undefined);
  const { name, dir } = split(path ?? "");
  return (
    <Screen>
      <ScreenHeader title={path ? name : "Changes"} meta={path && dir ? <Text style={styles.dir}>{dir}</Text> : null} />
      {path ? <FileChanges paneId={paneId} path={path} mode={mode ?? "uncommitted"} /> : <ChangesList paneId={paneId} mode={listMode} onMode={setListMode} />}
    </Screen>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    summary: { paddingHorizontal: space.lg, paddingBottom: space.sm, gap: 6 },
    summaryText: { fontSize: 13, color: colors.muted },
    totals: { flexDirection: "row", alignItems: "center" },
    totalsText: { fontSize: 13, color: colors.text, fontWeight: "600" },
    viewedText: { fontSize: 13, color: colors.muted },
    progress: { height: 3, borderRadius: 2, backgroundColor: colors.raised, overflow: "hidden", marginTop: 2 },
    progressFill: { height: 3, backgroundColor: colors.primary },
    modes: { flexDirection: "row", alignSelf: "flex-start", padding: 3, borderRadius: 999, backgroundColor: colors.raised, marginBottom: 6 },
    mode: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
    modeOn: { backgroundColor: colors.primary },
    modeText: { fontSize: 13, fontWeight: "600", color: colors.muted },
    modeTextOn: { color: colors.onPrimary },
    folder: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.subtle, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: 4 },
    row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: space.lg, paddingVertical: 10 },
    letter: { width: 12, fontFamily: fonts.mono, fontSize: 12, fontWeight: "700" },
    name: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.text },
    viewedName: { color: colors.subtle, fontWeight: "500" },
    commentCount: { fontSize: 11, fontWeight: "700", color: colors.onPrimary, backgroundColor: colors.primary, borderRadius: 8, minWidth: 16, paddingHorizontal: 4, textAlign: "center", overflow: "hidden" },
    dir: { fontSize: 12.5, color: colors.subtle },
    bar: { flexDirection: "row", gap: 2 },
    block: { width: 6, height: 6, borderRadius: 1.5, backgroundColor: colors.border },
    blockAdd: { backgroundColor: "#4ADE80" },
    blockDel: { backgroundColor: "#F87171" },
    footerRow: { paddingHorizontal: space.lg, paddingVertical: 12 },
    empty: { fontSize: 14, color: colors.muted, textAlign: "center", marginTop: 40, paddingHorizontal: space.xl },
    diff: { flex: 1, backgroundColor: colors.terminal },
    cut: { fontSize: 12.5, color: colors.muted, padding: space.md },
    comment: { marginLeft: 52, marginRight: space.md, marginVertical: 4, backgroundColor: colors.raised, borderRadius: radii.md, borderLeftWidth: 3, borderLeftColor: colors.primary, paddingHorizontal: 12, paddingVertical: 8 },
    commentText: { fontSize: 13.5, color: colors.text },
    fileBar: { paddingHorizontal: space.md, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, backgroundColor: colors.background },
    fileBarRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
    viewed: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.raised },
    viewedOn: { backgroundColor: colors.primary },
    viewedLabel: { fontSize: 13.5, fontWeight: "600", color: colors.text },
    position: { fontFamily: fonts.mono, fontSize: 12, color: colors.subtle, minWidth: 34, textAlign: "center" },
  }),
);
