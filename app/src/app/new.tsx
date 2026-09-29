import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import type { ProjectsResult, StartAgentParams, StartAgentResult } from "@sheperd/protocol";
import { shortPath } from "../lib/agents";
import { useConnection, useHostState } from "../lib/connection";
import { HostCallError } from "../lib/host-client";
import { usePalette } from "../theme";

/** agent.start waits up to a minute for the agent to be ready. */
const START_TIMEOUT_MS = 90_000;

export default function NewAgentScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { client } = useConnection();
  const { status } = useHostState();
  const [data, setData] = useState<ProjectsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [newWorktree, setNewWorktree] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!client || status !== "online") return;
    let cancelled = false;
    client
      .call<ProjectsResult>("sheperd.projects")
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setKind((k) => k ?? result.kinds[0] ?? null);
        setWorkspaceId((w) => w ?? result.projects[0]?.workspaceId ?? null);
        setError(null);
      })
      .catch((err: HostCallError) => {
        if (cancelled) return;
        setError(
          err.code === "invalid_message" || err.code === "unsupported"
            ? "Your host is out of date. Pull the latest sheperd and restart the host."
            : err.message,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [client, status]);

  const start = async () => {
    if (!client || !kind || !workspaceId) return;
    setStarting(true);
    try {
      const params: StartAgentParams = { kind, workspaceId, newWorktree, prompt: prompt.trim() || undefined };
      const result = await client.call<StartAgentResult>("sheperd.start_agent", params, { timeoutMs: START_TIMEOUT_MS });
      router.replace({ pathname: "/agent/[paneId]", params: { paneId: result.paneId } });
      if (!result.ready) {
        Alert.alert(`${kind} is waiting for you`, "It started but needs an answer first (for example, to trust the folder).");
      }
    } catch (err) {
      Alert.alert("Couldn't start the agent", (err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  if (error) {
    return <Text style={[styles.message, { color: palette.danger }]}>{error}</Text>;
  }
  if (!data) {
    return <ActivityIndicator style={{ marginTop: 32 }} />;
  }
  if (data.kinds.length === 0) {
    return (
      <Text style={[styles.message, { color: palette.muted }]}>
        No supported agent CLIs (claude, codex, gemini, …) were found on your computer&apos;s PATH.
      </Text>
    );
  }

  const selectedProject = data.projects.find((p) => p.workspaceId === workspaceId);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: palette.text }]}>Agent</Text>
        <View style={styles.chips}>
          {data.kinds.map((k) => (
            <Pressable
              key={k}
              onPress={() => setKind(k)}
              style={[
                styles.chip,
                k === kind ? { backgroundColor: palette.accent, borderColor: palette.accent } : { borderColor: palette.border },
              ]}
            >
              <Text style={{ color: k === kind ? "#FFFFFF" : palette.text, fontWeight: "600" }}>{k}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.label, { color: palette.text }]}>Project</Text>
        <View style={[styles.list, { borderColor: palette.border, backgroundColor: palette.surface }]}>
          {data.projects.map((p, i) => (
            <Pressable
              key={p.workspaceId}
              onPress={() => setWorkspaceId(p.workspaceId)}
              style={[styles.project, i > 0 && { borderTopWidth: 1, borderColor: palette.border }]}
            >
              <View style={[styles.radio, { borderColor: p.workspaceId === workspaceId ? palette.accent : palette.border }]}>
                {p.workspaceId === workspaceId ? <View style={[styles.radioDot, { backgroundColor: palette.accent }]} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: palette.text, fontWeight: "600" }} numberOfLines={1}>
                  {p.label}
                </Text>
                <Text style={{ color: palette.muted, fontSize: 12 }} numberOfLines={1}>
                  {shortPath(p.cwd) ?? p.workspaceId}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: palette.text, fontWeight: "600" }}>New git worktree</Text>
            <Text style={{ color: palette.muted, fontSize: 12 }}>
              Work on a separate checkout{selectedProject?.repoName ? ` of ${selectedProject.repoName}` : ""}, so agents don&apos;t
              step on each other.
            </Text>
          </View>
          <Switch value={newWorktree} onValueChange={setNewWorktree} />
        </View>

        <Text style={[styles.label, { color: palette.text }]}>First message (optional)</Text>
        <TextInput
          style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          value={prompt}
          onChangeText={setPrompt}
          placeholder="What should it work on?"
          placeholderTextColor={palette.muted}
          multiline
        />

        <Pressable
          onPress={start}
          disabled={starting || !kind || !workspaceId}
          style={[styles.button, { backgroundColor: palette.accent, opacity: starting ? 0.6 : 1 }]}
        >
          {starting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Start {kind}</Text>}
        </Pressable>
        {starting ? (
          <Text style={{ color: palette.muted, textAlign: "center" }}>Waiting for {kind} to be ready…</Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10 },
  message: { padding: 24, fontSize: 15, lineHeight: 22, textAlign: "center" },
  label: { fontSize: 14, fontWeight: "600", marginTop: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  list: { borderWidth: 1, borderRadius: 10 },
  project: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, minHeight: 80, fontSize: 15, textAlignVertical: "top" },
  button: { marginTop: 8, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontWeight: "600", fontSize: 16 },
});
