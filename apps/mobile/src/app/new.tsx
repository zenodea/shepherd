import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Folder, FolderPlus, FolderSearch, GitBranch, SquareTerminal } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TERMINAL_KIND, type ProjectsResult, type StartAgentParams, type StartAgentResult } from "@shepherd/protocol";
import { shortPath } from "../agents/agents";
import { FolderPicker } from "../agents/FolderPicker";
import { useConnection, useHostState } from "../connection/connection";
import { HostCallError } from "../connection/host-client";
import { AgentMark } from "../ui/AgentMark";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { ListGroup, ListRow } from "../ui/ListRow";
import { Divider, Screen } from "../ui/Screen";
import { Select } from "../ui/Select";
import { colors, fonts, space, type, themed } from "../ui/theme";
import { Toggle } from "../ui/Toggle";

const ANOTHER_FOLDER = "__another_folder__";

/** agent.start waits up to a minute for the agent to be ready. */
const START_TIMEOUT_MS = 90_000;

export default function NewAgentScreen() {
  const router = useRouter();
  const { workspace, kind: kindParam } = useLocalSearchParams<{ workspace?: string; kind?: string }>();
  const insets = useSafeAreaInsets();
  const { client } = useConnection();
  const { status } = useHostState();
  const [data, setData] = useState<ProjectsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [newWorktree, setNewWorktree] = useState(false);
  // A folder that isn't a herdr workspace yet: the agent starts in a new workspace there.
  const [folder, setFolder] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!client || status !== "online") return;
    let cancelled = false;
    client
      .call<ProjectsResult>("shepherd.projects")
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setKind((k) => k ?? kindParam ?? result.kinds[0] ?? TERMINAL_KIND);
        const preferred = result.projects.find((p) => p.workspaceId === workspace)?.workspaceId;
        setWorkspaceId((w) => w ?? preferred ?? result.projects[0]?.workspaceId ?? null);
        setError(null);
      })
      .catch((err: HostCallError) => {
        if (cancelled) return;
        setError(
          err.code === "invalid_message" || err.code === "unsupported"
            ? "Your host is out of date. Pull the latest Shepherd and restart the host."
            : err.message,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [client, status, workspace, kindParam]);

  const start = async () => {
    if (!client || !kind || !(folder ?? workspaceId)) return;
    setStarting(true);
    try {
      const where = folder ? { folder } : { workspaceId: workspaceId!, newWorktree };
      const params: StartAgentParams = { kind, ...where, prompt: prompt.trim() || undefined };
      const result = await client.call<StartAgentResult>("shepherd.start_agent", params, { timeoutMs: START_TIMEOUT_MS });
      router.replace({ pathname: "/agent/[paneId]", params: { paneId: result.paneId } });
      if (!result.ready && kind !== TERMINAL_KIND) {
        Alert.alert(`${kind} is waiting for you`, "It started but needs an answer first (for example, to trust the folder).");
      }
    } catch (err) {
      Alert.alert("Couldn't start the agent", (err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const selectedProject = data?.projects.find((p) => p.workspaceId === workspaceId);

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
          <ChevronLeft size={22} color={colors.text} />
        </IconButton>
        <Text style={styles.headerTitle}>New</Text>
      </View>

      {error ? (
        <Text style={[type.body, styles.message, { color: colors.danger }]}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.muted} />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
            <View>
              <Text style={styles.groupLabel}>Open</Text>
              <ListGroup>
                <Select
                  title="Open"
                  value={kind}
                  onChange={setKind}
                  options={[TERMINAL_KIND, ...data.kinds].map((k) => ({
                    value: k,
                    label: k === TERMINAL_KIND ? "Terminal" : k,
                    detail: k === TERMINAL_KIND ? "A plain shell" : null,
                    icon:
                      k === TERMINAL_KIND ? (
                        <View style={styles.terminalIcon}>
                          <SquareTerminal size={15} color={colors.muted} />
                        </View>
                      ) : (
                        <AgentMark agent={k} size={26} />
                      ),
                  }))}
                />
              </ListGroup>
            </View>

            <View>
              <Text style={styles.groupLabel}>Project</Text>
              <ListGroup>
                <Select
                  title="Project"
                  value={folder ? `folder:${folder}` : workspaceId}
                  onChange={(value) => {
                    if (value === ANOTHER_FOLDER) return setPicking(true);
                    if (value.startsWith("folder:")) return;
                    setFolder(null);
                    setWorkspaceId(value);
                  }}
                  options={[
                    ...data.projects.map((p) => ({
                      value: p.workspaceId,
                      label: p.label,
                      detail: shortPath(p.cwd) ?? p.workspaceId,
                      icon: <Folder size={19} color={colors.muted} />,
                    })),
                    ...(folder
                      ? [{ value: `folder:${folder}`, label: folder.split("/").pop() ?? folder, detail: `${shortPath(folder)} · new workspace`, icon: <FolderPlus size={19} color={colors.muted} /> }]
                      : []),
                    { value: ANOTHER_FOLDER, label: "Another folder…", detail: "Start in any folder on your computer", icon: <FolderSearch size={19} color={colors.muted} /> },
                  ]}
                />
                {folder ? null : (
                  <>
                    <Divider />
                    <ListRow
                      icon={<GitBranch size={19} color={colors.muted} />}
                      title="New git worktree"
                      detail={`A separate checkout${selectedProject?.repoName ? ` of ${selectedProject.repoName}` : ""}, so agents don't collide`}
                      chevron={false}
                      trailing={<Toggle value={newWorktree} onValueChange={setNewWorktree} />}
                    />
                  </>
                )}
              </ListGroup>
            </View>

            <View>
              <Text style={styles.groupLabel}>{kind === TERMINAL_KIND ? "Command to run (optional)" : "First message (optional)"}</Text>
              <TextInput
                style={[styles.input, kind === TERMINAL_KIND && { fontFamily: fonts.mono, minHeight: 52 }]}
                value={prompt}
                onChangeText={setPrompt}
                placeholder={kind === TERMINAL_KIND ? "e.g. npm run dev" : "What should it work on?"}
                autoCapitalize={kind === TERMINAL_KIND ? "none" : "sentences"}
                autoCorrect={kind !== TERMINAL_KIND}
                placeholderTextColor={colors.subtle}
                multiline
              />
            </View>
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
            <Button
              title={kind === TERMINAL_KIND ? "Open terminal" : starting ? `Starting ${kind}…` : `Start ${kind ?? "agent"}`}
              loading={starting}
              disabled={!kind || !(folder ?? workspaceId)}
              onPress={start}
            />
          </View>
        </KeyboardAvoidingView>
      )}
      <FolderPicker client={client} visible={picking} onClose={() => setPicking(false)} onPick={setFolder} />
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  headerTitle: { fontSize: 17, fontWeight: "600", color: colors.text },
  message: { padding: space.xl, textAlign: "center" },
  groupLabel: { ...type.sub, paddingHorizontal: space.lg + 4, paddingBottom: 8 },
  input: {
    marginHorizontal: space.lg,
    backgroundColor: colors.surface,
    borderRadius: 14,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 96,
    textAlignVertical: "top",
  },
  terminalIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
}));
