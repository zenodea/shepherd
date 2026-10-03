import { ArrowUp, X } from "lucide-react-native";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { HostConnection } from "../connection/host-client";
import { PressableScale } from "../ui/Pressable";
import { colors, fonts, radii, space, type, themed } from "../ui/theme";
import type { BlockedPrompt, PromptOption } from "@shepherd/protocol";
import { sendAnswer } from "./answer";

function keyLabel(key: string): string {
  if (key === "esc") return "esc";
  if (key === "shift+tab") return "⇧tab";
  return key;
}

type Option = Pick<PromptOption, "key" | "label" | "selected" | "input">;

function useAnswer(client: HostConnection | null, paneId: string) {
  const [sent, setSent] = useState<string | null>(null);
  // An option where you write the answer: its text box is open.
  const [writing, setWriting] = useState<Option | null>(null);
  const send = async (option: Option, text?: string) => {
    if (!client) return;
    setSent(text ?? option.label);
    setWriting(null);
    try {
      await sendAnswer(client, paneId, option, text);
    } catch (err) {
      setSent(null);
      Alert.alert("Couldn't answer", (err as Error).message);
    }
  };
  /** Pressing an option: send it, or open its text box. */
  const pick = (option: Option) => (option.input ? setWriting(option) : void send(option));
  return { sent, send, pick, writing, cancel: () => setWriting(null) };
}

/** The text box for an option where you write the answer yourself. */
function WriteAnswer({ option, onSend, onCancel }: { option: Option; onSend: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const ready = text.trim().length > 0;
  return (
    <View style={styles.write}>
      <PressableScale onPress={onCancel} style={styles.writeCancel} accessibilityLabel="Back to the answers">
        <X size={16} color={colors.muted} />
      </PressableScale>
      <TextInput
        style={styles.writeInput}
        value={text}
        onChangeText={setText}
        placeholder={option.label}
        placeholderTextColor={colors.subtle}
        autoFocus
        multiline
        accessibilityLabel={option.label}
      />
      <PressableScale
        onPress={() => ready && onSend(text.trim())}
        disabled={!ready}
        style={[styles.writeSend, !ready && { opacity: 0.4 }]}
        accessibilityRole="button"
        accessibilityLabel="Send answer"
      >
        <ArrowUp size={16} color={colors.onPrimary} strokeWidth={2.5} />
      </PressableScale>
    </View>
  );
}

function withEsc(prompt: BlockedPrompt): Option[] {
  return prompt.options.some((o) => o.key === "esc") ? prompt.options : [...prompt.options, { key: "esc", label: "Cancel", selected: false }];
}

/** What a blocked agent is asking, with one button per answer (agent list). */
export function PromptCard({ client, paneId, prompt }: { client: HostConnection | null; paneId: string; prompt: BlockedPrompt }) {
  const { sent, send, pick, writing, cancel } = useAnswer(client, paneId);
  // Keep the question itself; drop tool-output context like "⎿ Updated …".
  const question = prompt.lines
    .map((l) => l.trim())
    .filter((l) => l && !/^[⎿└⏺●•│]/.test(l))
    .slice(-2);

  return (
    <View style={{ gap: space.sm }}>
      {question.length > 0 ? (
        <Text style={styles.question} numberOfLines={4}>
          {question.join("\n")}
        </Text>
      ) : null}
      {sent ? (
        <Text style={type.sub}>Sent “{sent}”…</Text>
      ) : writing ? (
        <WriteAnswer option={writing} onSend={(text) => void send(writing, text)} onCancel={cancel} />
      ) : prompt.options.length > 0 ? (
        <View style={styles.options}>
          {withEsc(prompt).map((option) => (
            <PressableScale
              key={`${option.key}-${option.label}`}
              onPress={() => pick(option)}
              style={[styles.option, option.selected && styles.optionSelected]}
              accessibilityRole="button"
              accessibilityLabel={`Answer: ${option.label}`}
            >
              <Text style={[styles.key, option.selected && { color: colors.onPrimary, borderColor: colors.hairline }]} maxFontSizeMultiplier={1.3}>
                {keyLabel(option.key)}
              </Text>
              <Text style={[styles.optionLabel, option.selected && { color: colors.onPrimary }]} numberOfLines={2}>
                {option.label}
              </Text>
            </PressableScale>
          ))}
        </View>
      ) : (
        <Text style={type.sub}>Open the agent to answer.</Text>
      )}
    </View>
  );
}

/** The same answers as a row of compact chips (above the composer). */
export function PromptChips({ client, paneId, prompt }: { client: HostConnection | null; paneId: string; prompt: BlockedPrompt }) {
  const { sent, send, pick, writing, cancel } = useAnswer(client, paneId);
  if (prompt.options.length === 0) return null;
  if (sent) return <Text style={[type.sub, { paddingHorizontal: space.lg, paddingVertical: 10 }]}>Sent “{sent}”…</Text>;
  if (writing) {
    return (
      <View style={{ paddingHorizontal: space.md, paddingVertical: 6 }}>
        <WriteAnswer option={writing} onSend={(text) => void send(writing, text)} onCancel={cancel} />
      </View>
    );
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
      {withEsc(prompt).map((option) => (
        <PressableScale
          key={`${option.key}-${option.label}`}
          onPress={() => pick(option)}
          style={[styles.chip, option.selected && styles.optionSelected]}
          accessibilityRole="button"
          accessibilityLabel={`Answer: ${option.label}`}
        >
          <Text style={[styles.chipText, option.selected && { color: colors.onPrimary }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
            {option.label}
          </Text>
        </PressableScale>
      ))}
    </ScrollView>
  );
}

const styles = themed(() => StyleSheet.create({
  question: { fontSize: 14, lineHeight: 20, color: colors.text },
  options: { gap: 6 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.raised,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  optionSelected: { backgroundColor: colors.primary },
  key: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.muted,
    minWidth: 26,
    textAlign: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 5,
    paddingVertical: 1,
    paddingHorizontal: 4,
    overflow: "hidden",
  },
  optionLabel: { flex: 1, fontSize: 14, fontWeight: "500", color: colors.text },
  chips: { gap: 6, paddingHorizontal: space.md, paddingVertical: 8 },
  chip: { backgroundColor: colors.raised, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 8, maxWidth: 260 },
  chipText: { fontSize: 13.5, fontWeight: "500", color: colors.text },
  write: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 4,
  },
  writeCancel: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  writeInput: { flex: 1, color: colors.text, fontSize: 15, maxHeight: 120, paddingTop: 8, paddingBottom: 8, textAlignVertical: "top" },
  writeSend: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
}));
