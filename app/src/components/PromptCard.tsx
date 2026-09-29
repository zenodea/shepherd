import { useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { HostClient } from "../lib/host-client";
import type { BlockedPrompt } from "../lib/prompt-options";
import { usePalette } from "../theme";

const MONO = Platform.select({ android: "monospace", default: "Menlo" });

/** The question a blocked agent is showing, with one button per answer. */
export function PromptCard({ client, paneId, prompt }: { client: HostClient | null; paneId: string; prompt: BlockedPrompt }) {
  const palette = usePalette();
  const [sent, setSent] = useState<string | null>(null);

  const send = async (key: string, label: string) => {
    if (!client) return;
    setSent(label);
    try {
      await client.call("agent.send_keys", { target: paneId, keys: [key] });
    } catch (err) {
      setSent(null);
      Alert.alert("Couldn't answer", (err as Error).message);
    }
  };

  const hasEsc = prompt.options.some((o) => o.key === "esc");

  return (
    <View style={[styles.card, { backgroundColor: palette.background, borderColor: palette.border }]}>
      {prompt.lines.map((line, i) => (
        <Text key={i} style={[styles.line, { color: palette.text }]} numberOfLines={2}>
          {line.trim()}
        </Text>
      ))}
      {sent ? (
        <Text style={[styles.sent, { color: palette.muted }]}>Sent “{sent}”…</Text>
      ) : prompt.options.length > 0 ? (
        <View style={styles.options}>
          {prompt.options.map((option) => (
            <Pressable
              key={`${option.key}-${option.label}`}
              onPress={() => send(option.key, option.label)}
              style={({ pressed }) => [
                styles.option,
                option.selected
                  ? { backgroundColor: palette.accent, borderColor: palette.accent }
                  : { borderColor: palette.border, backgroundColor: palette.surface },
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={{ color: option.selected ? "#FFFFFF" : palette.text, fontSize: 14 }} numberOfLines={2}>
                {option.label}
              </Text>
            </Pressable>
          ))}
          {!hasEsc ? (
            <Pressable
              onPress={() => send("esc", "Esc")}
              style={({ pressed }) => [styles.option, { borderColor: palette.border, opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={{ color: palette.muted, fontSize: 14 }}>Esc</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <Text style={[styles.sent, { color: palette.muted }]}>Open the agent to answer.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 4 },
  line: { fontFamily: MONO, fontSize: 12, lineHeight: 16 },
  options: { gap: 6, marginTop: 6 },
  option: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  sent: { fontSize: 13, marginTop: 4 },
});
