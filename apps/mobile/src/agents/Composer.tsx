import { ArrowUp, ImagePlus, Keyboard as KeyboardIcon, Plus, Square, X } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { AgentInfo, SlashCommand } from "@shepherd/protocol";
import type { HostConnection } from "../connection/host-client";
import { PressableScale } from "../ui/Pressable";
import { PromptSheet } from "../ui/PromptSheet";
import { colors, fonts, themed } from "../ui/theme";
import { agentName } from "./agents";
import { withImages } from "./attachment-message";
import { useAttachments } from "./attachments";
import { getDraft, saveDraft, useDraftRevision, useDraftsReady } from "./drafts";
import { removeReply, saveReply, useSavedReplies } from "./saved-replies";
import { commandIn, matchCommands, useSlashCommands } from "./slash-commands";

/** react-native-web renders a multiline input as a two-row textarea unless told otherwise. */
const WEB_ONE_ROW = Platform.OS === "web" ? ({ rows: 1 } as object) : {};

/** Quick keys (herdr key names), grouped like Superset's bar. */
const QUICK_KEYS: { label: string; name: string; keys: string[]; confirm?: string }[][] = [
  [
    { label: "esc", name: "Escape", keys: ["esc"] },
    { label: "↵", name: "Enter", keys: ["enter"] },
    { label: "tab", name: "Tab", keys: ["tab"] },
    { label: "⇧tab", name: "Shift Tab", keys: ["shift+tab"] },
  ],
  [
    { label: "↑", name: "Up arrow", keys: ["up"] },
    { label: "↓", name: "Down arrow", keys: ["down"] },
    { label: "←", name: "Left arrow", keys: ["left"] },
    { label: "→", name: "Right arrow", keys: ["right"] },
  ],
  [{ label: "^C", name: "Control C", keys: ["ctrl+c"], confirm: "Send Ctrl-C?" }],
];

type Props = {
  client: HostConnection | null;
  agent: AgentInfo | null;
  /** Unsent text is kept under this (per computer and pane); remount with it as the key so images stay with their pane. */
  draftKey: string;
  chat: boolean;
  /** Offline: what you write stays in the box (and is kept), ready to send once connected. */
  online: boolean;
  /** Typing straight into the terminal: the message box steps aside. */
  typing: boolean;
  onToggleTyping: () => void;
  onKeys: (keys: string[], confirm?: string) => void;
  /** Resolves false when the message didn't go, so the draft stays. `command`: the "/" command it starts with. */
  onSend: (text: string, command: SlashCommand | null) => Promise<boolean>;
};

/** The quick keys and the message box, with its own state so typing doesn't redraw the conversation. */
export function Composer({ client, agent, draftKey, chat, online, typing, onToggleTyping, onKeys, onSend }: Props) {
  const [draft, setDraft] = useState("");
  // Unsent text is kept per agent: switching agents or leaving keeps it.
  const draftsReady = useDraftsReady();
  const draftRevision = useDraftRevision(draftKey);
  const [draftOf, setDraftOf] = useState<number | null>(null);
  if (draftsReady && draftOf !== draftRevision) {
    setDraftOf(draftRevision);
    setDraft(getDraft(draftKey));
  }
  const changeDraft = (text: string) => {
    setDraft(text);
    saveDraft(draftKey, text);
  };
  const attachments = useAttachments(client);
  const [sending, setSending] = useState(false);
  // "/" commands: suggestions while you type a name, then what it takes once you've picked one.
  const commands = useSlashCommands(client, agent?.pane_id ?? null, draft.startsWith("/"));
  const naming = /^\/\S*$/.test(draft);
  // Only in the chat: the terminal view keeps to the terminal (things appearing here would resize it).
  const suggestions = naming && !typing && chat ? matchCommands(commands, draft) : [];
  const picked = !naming ? commandIn(commands, draft) : null;
  const hint = picked?.hint && draft.trim() === picked.name ? picked.hint : null;
  // Saved replies: only while you're about to write (the box focused and empty), so they're out of sight otherwise.
  const replies = useSavedReplies();
  const [focused, setFocused] = useState(false);
  const [editing, setEditing] = useState<{ reply?: string } | null>(null);
  const showReplies = chat && focused && !draft && !typing && attachments.attachments.length === 0;
  const replyOptions = (reply: string) =>
    Alert.alert(reply, undefined, [
      { text: "Edit", onPress: () => setEditing({ reply }) },
      { text: "Delete", style: "destructive", onPress: () => removeReply(reply) },
      { text: "Cancel", style: "cancel" },
    ]);

  const submit = async () => {
    const text = agent ? withImages(draft.trim(), attachments.attachments) : draft.trim();
    if (!text || attachments.uploading) return;
    setSending(true);
    if (await onSend(text, commandIn(commands, text))) {
      changeDraft("");
      attachments.clear();
    }
    setSending(false);
  };

  const canSend = online && (draft.trim().length > 0 || attachments.ready) && !attachments.uploading && !sending;

  return (
    <>
      {suggestions.length > 0 && !(suggestions.length === 1 && suggestions[0]!.name === draft) ? (
        <ScrollView style={styles.suggestions} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {suggestions.map((c, i) => (
            <PressableScale
              key={c.name}
              onPress={() => changeDraft(`${c.name} `)}
              style={[styles.suggestion, i > 0 && styles.suggestionDivider]}
              accessibilityLabel={`${c.name}, ${c.description}`}
            >
              <Text style={styles.suggestionName} numberOfLines={1}>
                {c.name}
              </Text>
              <Text style={styles.suggestionText} numberOfLines={1}>
                {c.description}
              </Text>
            </PressableScale>
          ))}
        </ScrollView>
      ) : showReplies ? (
        <ScrollView horizontal style={styles.replies} contentContainerStyle={styles.repliesInner} keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}>
          {replies.map((reply) => (
            <PressableScale key={reply} onPress={() => changeDraft(reply)} onLongPress={() => replyOptions(reply)} style={styles.reply} accessibilityLabel={`Saved reply: ${reply}`} accessibilityHint="Puts it in your message. Long-press to edit or delete.">
              <Text style={styles.replyText} numberOfLines={1}>
                {reply}
              </Text>
            </PressableScale>
          ))}
          <PressableScale onPress={() => setEditing({})} style={styles.reply} accessibilityLabel="Save a new reply">
            <Plus size={14} color={colors.muted} />
          </PressableScale>
        </ScrollView>
      ) : hint ? (
        <Text style={styles.hint} numberOfLines={1}>
          {picked!.name} <Text style={{ color: colors.subtle }}>{hint}</Text>
        </Text>
      ) : null}
      <View style={styles.keys}>
        {chat ? null : (
          <PressableScale
            onPress={onToggleTyping}
            style={[styles.key, styles.typeKey, typing && styles.typeKeyActive]}
            accessibilityRole="switch"
            accessibilityState={{ checked: typing }}
            accessibilityLabel="Type straight into the terminal"
          >
            <KeyboardIcon size={16} color={typing ? colors.onPrimary : colors.text} />
          </PressableScale>
        )}
        {QUICK_KEYS.map((group, gi) => (
          // A divider between groups, and after ⌨ (which the chat view doesn't have).
          <View key={gi} style={[styles.keyGroup, (gi > 0 || !chat) && styles.keyGroupDivider]}>
            {group.map((k) => (
              <PressableScale key={k.label} onPress={() => onKeys(k.keys, k.confirm)} style={styles.key} accessibilityLabel={`Send ${k.name}`}>
                <Text style={styles.keyLabel} maxFontSizeMultiplier={1.3}>
                  {k.label}
                </Text>
              </PressableScale>
            ))}
          </View>
        ))}
      </View>

      {!typing && attachments.attachments.length ? (
        <ScrollView horizontal style={styles.attachments} contentContainerStyle={styles.attachmentsInner} keyboardShouldPersistTaps="handled">
          {attachments.attachments.map((a) => (
            <View key={a.id} style={[styles.attachment, a.state === "failed" && styles.attachmentFailed]}>
              <Image source={{ uri: a.uri }} style={styles.attachmentImage} />
              {a.state === "uploading" ? <ActivityIndicator style={styles.attachmentOverlay} color="#FFFFFF" /> : null}
              <PressableScale onPress={() => attachments.remove(a.id)} style={styles.attachmentRemove} accessibilityLabel="Remove image">
                <X size={12} color="#FFFFFF" />
              </PressableScale>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {!typing ? (
        <View style={[styles.composer, agent && styles.composerWithAttach]}>
          {agent ? (
            <PressableScale onPress={() => void attachments.add()} style={styles.attach} accessibilityLabel="Add an image">
              <ImagePlus size={19} color={colors.muted} />
            </PressableScale>
          ) : null}
          <TextInput
            {...WEB_ONE_ROW}
            style={styles.input}
            value={draft}
            onChangeText={changeDraft}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={agent ? `Message ${agentName(agent)}…` : "Run a command…"}
            placeholderTextColor={colors.subtle}
            accessibilityLabel={agent ? `Message ${agentName(agent)}` : "Command to run"}
            multiline
          />
          {/* Separate keys: Android draws a restyled stop button wrong, so each is its own view. */}
          {!online && draft.trim() ? (
            <View key="offline" style={[styles.send, styles.sendOffline]} accessibilityLabel="Can't send while offline">
              <ArrowUp size={18} color={colors.muted} strokeWidth={2.5} />
            </View>
          ) : canSend || sending ? (
            <PressableScale key="send" onPress={submit} disabled={!canSend} style={styles.send} accessibilityLabel="Send">
              <ArrowUp size={18} color={colors.onPrimary} strokeWidth={2.5} />
            </PressableScale>
          ) : agent?.agent_status === "working" ? (
            // Esc interrupts Claude Code, Codex and pi alike.
            <PressableScale key="stop" onPress={() => onKeys(["esc"])} style={styles.stop} accessibilityLabel={`Stop ${agentName(agent)}`}>
              <Square size={13} color={colors.text} fill={colors.text} />
            </PressableScale>
          ) : null}
        </View>
      ) : (
        <Text style={styles.typingHint}>Typing into the terminal · tap ⌨ to stop</Text>
      )}
      {!online && !typing && draft.trim() ? <Text style={styles.offlineHint}>Offline · your message stays here until you&apos;re back</Text> : null}
      <PromptSheet
        visible={editing !== null}
        title={editing?.reply ? "Edit saved reply" : "New saved reply"}
        initial={editing?.reply ?? ""}
        placeholder="e.g. run the tests and fix what fails"
        onSubmit={(text) => saveReply(text, editing?.reply)}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  keys: {
    flexDirection: "row",
    alignSelf: "stretch",
    marginHorizontal: 12,
    backgroundColor: colors.raised,
    borderRadius: 11,
    height: 36,
    alignItems: "center",
    paddingHorizontal: 3,
  },
  keyGroup: { flexDirection: "row", alignItems: "center", flexGrow: 1, justifyContent: "space-around" },
  keyGroupDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderColor: colors.edge },
  key: { minWidth: 30, height: 30, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", borderRadius: 7 },
  typeKey: { marginRight: 3, width: 34 },
  typeKeyActive: { backgroundColor: colors.primary },
  keyLabel: { fontFamily: fonts.mono, fontSize: 13, color: colors.text },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginHorizontal: 12,
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingLeft: 16,
    // 6 + the 34pt button + 6 = 46: on one line the button sits in the exact middle of the rounded end.
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 46,
  },
  // One line is exactly as tall as the button (20 + 7 + 7), so the two line up.
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    // No lineHeight: Android applies it to typed text but not to the placeholder, which then sits a pixel off.
    maxHeight: 120,
    paddingTop: 8,
    paddingBottom: 8,
    textAlignVertical: "top",
    includeFontPadding: false,
  },
  send: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  composerWithAttach: { paddingLeft: 6 },
  attach: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  attachments: { flexGrow: 0, marginHorizontal: 12, marginBottom: 8 },
  attachmentsInner: { gap: 8 },
  attachment: { width: 56, height: 56, borderRadius: 12, overflow: "hidden", backgroundColor: colors.raised },
  attachmentFailed: { borderWidth: 2, borderColor: colors.danger },
  attachmentImage: { width: 56, height: 56 },
  attachmentOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.35)" },
  attachmentRemove: { position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  stop: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  // About five and a half rows: the cut-off one says there's more to scroll to.
  suggestions: { flexGrow: 0, maxHeight: 205, marginHorizontal: 12, marginBottom: 6, backgroundColor: colors.raised, borderRadius: 11 },
  suggestion: { flexDirection: "row", alignItems: "baseline", gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  suggestionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.edge },
  suggestionName: { fontFamily: fonts.mono, fontSize: 13.5, color: colors.text, flexShrink: 0, maxWidth: "55%" },
  suggestionText: { flex: 1, fontSize: 12.5, color: colors.muted },
  replies: { flexGrow: 0, marginBottom: 6 },
  repliesInner: { gap: 6, paddingHorizontal: 12 },
  reply: { height: 30, minWidth: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
  replyText: { fontSize: 13, color: colors.text, maxWidth: 220 },
  hint: { marginHorizontal: 24, marginBottom: 6, fontFamily: fonts.mono, fontSize: 12.5, color: colors.muted },
  sendOffline: { backgroundColor: colors.raised },
  offlineHint: { fontSize: 12, color: colors.muted, textAlign: "center", paddingTop: 6 },
  typingHint: { fontSize: 12.5, color: colors.muted, textAlign: "center", paddingVertical: 12 },
}));
