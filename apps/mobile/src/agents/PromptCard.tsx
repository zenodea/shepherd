import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import type { HostConnection } from "../connection/host-client";
import { PressableScale } from "../ui/Pressable";
import { colors, fonts, radii, space, type } from "../ui/theme";
import type { BlockedPrompt, PromptOption } from "@sheperd/protocol";

function keyLabel(key: string): string {
  if (key === "esc") return "esc";
  if (key === "shift+tab") return "⇧tab";
  return key;
}

function useAnswer(client: HostConnection | null, paneId: string) {
  const [sent, setSent] = useState<string | null>(null);
  const send = async (option: Pick<PromptOption, "key" | "label">) => {
    if (!client) return;
    setSent(option.label);
    try {
      await client.call("agent.send_keys", { target: paneId, keys: [option.key] });
    } catch (err) {
      setSent(null);
      Alert.alert("Couldn't answer", (err as Error).message);
    }
  };
  return { sent, send };
}

function withEsc(prompt: BlockedPrompt): Pick<PromptOption, "key" | "label" | "selected">[] {
  return prompt.options.some((o) => o.key === "esc") ? prompt.options : [...prompt.options, { key: "esc", label: "Cancel", selected: false }];
}

/** What a blocked agent is asking, with one button per answer (agent list). */
export function PromptCard({ client, paneId, prompt }: { client: HostConnection | null; paneId: string; prompt: BlockedPrompt }) {
  const { sent, send } = useAnswer(client, paneId);
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
      ) : prompt.options.length > 0 ? (
        <View style={styles.options}>
          {withEsc(prompt).map((option) => (
            <PressableScale key={`${option.key}-${option.label}`} onPress={() => send(option)} style={[styles.option, option.selected && styles.optionSelected]}>
              <Text style={[styles.key, option.selected && { color: colors.onPrimary, borderColor: "rgba(0,0,0,0.15)" }]}>{keyLabel(option.key)}</Text>
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
  const { sent, send } = useAnswer(client, paneId);
  if (prompt.options.length === 0) return null;
  if (sent) return <Text style={[type.sub, { paddingHorizontal: space.lg, paddingVertical: 10 }]}>Sent “{sent}”…</Text>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
      {withEsc(prompt).map((option) => (
        <PressableScale key={`${option.key}-${option.label}`} onPress={() => send(option)} style={[styles.chip, option.selected && styles.optionSelected]}>
          <Text style={[styles.chipText, option.selected && { color: colors.onPrimary }]} numberOfLines={1}>
            {option.label}
          </Text>
        </PressableScale>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
});
