import { useRouter } from "expo-router";
import { MessageSquare } from "lucide-react-native";
import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HostCallError, type HostConnection } from "../connection/host-client";
import { Button } from "../ui/Button";
import { PressableScale } from "../ui/Pressable";
import { Sheet } from "../ui/Sheet";
import { colors, fonts, radii, space, type, themed } from "../ui/theme";
import { clearComments, type ReviewComment } from "./review";
import { reviewMessage } from "./review-message";

/** Where a comment goes: the file, the line and its code. */
export type CommentTarget = { path: string; side: "new" | "old"; line: number; code: string; comment?: ReviewComment };

/** Write (or change, or delete) a comment on one line. */
export function CommentSheet({ target, onSave, onDelete, onClose }: { target: CommentTarget | null; onSave: (text: string) => void; onDelete: () => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Sheet visible={target !== null} onClose={onClose} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
      {target ? <CommentBody key={`${target.path}:${target.side}:${target.line}:${target.comment?.id ?? "new"}`} target={target} onSave={onSave} onDelete={onDelete} onClose={onClose} /> : null}
    </Sheet>
  );
}

function CommentBody({ target, onSave, onDelete, onClose }: { target: CommentTarget; onSave: (text: string) => void; onDelete: () => void; onClose: () => void }) {
  const [text, setText] = useState(target.comment?.text ?? "");
  const save = () => {
    if (!text.trim()) return;
    onSave(text.trim());
    onClose();
  };
  return (
    <>
      <Text style={[type.section, styles.pad]}>
        {target.side === "old" ? "Removed line" : "Line"} {target.line}
      </Text>
      {target.code.trim() ? (
        <Text style={styles.quote} numberOfLines={3}>
          {target.code.trim()}
        </Text>
      ) : null}
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="What should change here?"
        placeholderTextColor={colors.subtle}
        multiline
        autoFocus
      />
      <View style={styles.actions}>
        {target.comment ? (
          <Button
            title="Delete"
            variant="secondary"
            size="md"
            onPress={() => {
              onDelete();
              onClose();
            }}
            style={{ flex: 1 }}
          />
        ) : null}
        <Button title={target.comment ? "Save" : "Comment"} size="md" onPress={save} disabled={!text.trim()} style={{ flex: 2 }} />
      </View>
    </>
  );
}

/** Pending comments, above the bottom of the changes screens: tap to send them. */
export function ReviewBar({ count, onPress }: { count: number; onPress: () => void }) {
  if (count === 0) return null;
  return (
    <PressableScale onPress={onPress} style={styles.bar} accessibilityLabel={`Send review, ${count} comment${count === 1 ? "" : "s"}`}>
      <MessageSquare size={15} color={colors.onPrimary} />
      <Text style={styles.barText}>
        Send review · {count} comment{count === 1 ? "" : "s"}
      </Text>
    </PressableScale>
  );
}

/** Send every comment to the agent as one message, with a note if you like. */
export function SendReviewSheet({
  visible,
  client,
  paneId,
  reviewKey,
  agentName,
  comments,
  onClose,
}: {
  visible: boolean;
  client: HostConnection | null;
  paneId: string;
  reviewKey: string;
  agentName: string;
  comments: ReviewComment[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Sheet visible={visible} onClose={onClose} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
      {visible ? <SendBody client={client} paneId={paneId} reviewKey={reviewKey} agentName={agentName} comments={comments} onClose={onClose} /> : null}
    </Sheet>
  );
}

function SendBody({ client, paneId, reviewKey, agentName, comments, onClose }: { client: HostConnection | null; paneId: string; reviewKey: string; agentName: string; comments: ReviewComment[]; onClose: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const files = new Set(comments.map((c) => c.path)).size;
  const send = async () => {
    if (!client) return;
    setSending(true);
    try {
      await client.call("agent.prompt", { target: paneId, text: reviewMessage(comments, note) });
      clearComments(reviewKey);
      onClose();
      router.dismissTo({ pathname: "/agent/[paneId]", params: { paneId } });
    } catch (err) {
      setSending(false);
      if (err instanceof HostCallError && err.code === "agent_blocked") Alert.alert(`${agentName} is waiting for an answer`, "Answer its question first, then send your review. Your comments are kept.");
      else Alert.alert("Couldn't send", (err as Error).message);
    }
  };
  return (
    <>
      <Text style={[type.section, styles.pad]}>Send review to {agentName}</Text>
      <Text style={[type.sub, styles.pad]}>
        {comments.length} comment{comments.length === 1 ? "" : "s"} on {files} file{files === 1 ? "" : "s"}, sent as one message.
      </Text>
      <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Anything else? (optional)" placeholderTextColor={colors.subtle} multiline />
      <Button title="Send review" onPress={() => void send()} loading={sending} disabled={!client} />
    </>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    sheet: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.md },
    pad: { paddingHorizontal: 4 },
    quote: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.muted, backgroundColor: colors.terminal, borderRadius: radii.sm, paddingHorizontal: 10, paddingVertical: 8 },
    input: {
      backgroundColor: colors.surface,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      color: colors.text,
      fontSize: 15,
      paddingHorizontal: 12,
      paddingVertical: 10,
      minHeight: 80,
      maxHeight: 180,
      textAlignVertical: "top",
    },
    actions: { flexDirection: "row", gap: space.sm },
    bar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      alignSelf: "center",
      backgroundColor: colors.primary,
      borderRadius: radii.pill,
      paddingHorizontal: 16,
      paddingVertical: 10,
      marginBottom: space.sm,
    },
    barText: { fontSize: 14, fontWeight: "600", color: colors.onPrimary },
  }),
);
