import { useLocalSearchParams, useRouter } from "expo-router";
import { Folder, FolderPlus, FolderSearch, GitBranch, Laptop, SquareTerminal } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TERMINAL_KIND, type HandoffResult, type ProjectsResult, type StartAgentParams, type StartAgentResult } from "@shepherd/protocol";
import { shortPath } from "../agents/agents";
import { FolderPicker } from "../agents/FolderPicker";
import { defaultTarget, leftBehind, matchingProject } from "../agents/handoff";
import { useClientState, useComputerStates, useConnection } from "../connection/connection";
import { HostCallError, type HostConnection } from "../connection/host-client";
import { AgentMark } from "../ui/AgentMark";
import { Button } from "../ui/Button";
import { ListGroup, ListRow } from "../ui/ListRow";
import { Divider, Screen, ScreenHeader } from "../ui/Screen";
import { Select } from "../ui/Select";
import { colors, fonts, space, type, themed } from "../ui/theme";
import { Toggle } from "../ui/Toggle";

const ANOTHER_FOLDER = "__another_folder__";

type Choices = { kind?: string; workspaceId?: string; folder?: string | null; newWorktree?: boolean };

/** agent.start waits up to a minute for the agent to be ready. */
const START_TIMEOUT_MS = 90_000;

export default function NewAgentScreen() {
  const router = useRouter();
  // `from` and `pane`: hand that agent's work off to the new one, on the computer picked here.
  const { workspace, kind: kindParam, from, pane } = useLocalSearchParams<{ workspace?: string; kind?: string; from?: string; pane?: string }>();
  const insets = useSafeAreaInsets();
  const { client: activeClient, computers, switchTo } = useConnection();
  const states = useComputerStates(computers);
  const handingOff = !!(from && pane);
  const source = handingOff ? (computers.find((c) => c.host.id === from) ?? null) : null;
  const sourceStatus = useClientState(source?.client ?? null).status;
  const [picked, setPicked] = useState<string | null>(null);
  const targetId = handingOff
    ? (picked ?? defaultTarget(computers.map((c, i) => ({ id: c.host.id, online: states[i]?.status === "online" })), from!))
    : null;
  const target = handingOff ? (computers.find((c) => c.host.id === targetId) ?? null) : null;
  const client = handingOff ? (target?.client ?? null) : activeClient;
  const { status } = useClientState(client);
  const [handoff, setHandoff] = useState<HandoffResult | null>(null);
  // Answers are kept with the connection that gave them: another computer has other projects.
  const [loaded, setLoaded] = useState<{ client: HostConnection; result: ProjectsResult } | null>(null);
  const [failure, setFailure] = useState<{ client: HostConnection; message: string } | null>(null);
  const data = loaded && loaded.client === client ? loaded.result : null;
  const error = failure && failure.client === client ? failure.message : null;
  // What you picked on this computer; until you pick, the suggestions below.
  const [choices, setChoices] = useState<{ on: string | null; picked: Choices }>({ on: null, picked: {} });
  const mine = choices.on === targetId ? choices.picked : {};
  const choose = (choice: Choices) =>
    setChoices((prev) => ({ on: targetId, picked: { ...(prev.on === targetId ? prev.picked : {}), ...choice } }));
  const [picking, setPicking] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [starting, setStarting] = useState(false);

  // When handing off: the same agent kind, in the project holding the same code.
  const handed = handoff?.available ? handoff : null;
  const sameComputer = !handingOff || targetId === from;
  const suggestedProject = data ? (sameComputer ? data.projects.find((p) => p.workspaceId === workspace) : handed ? matchingProject(data.projects, handed) : null) : null;
  const suggestedKind = handed?.agent && data?.kinds.includes(handed.agent) ? handed.agent : (kindParam ?? data?.kinds[0] ?? TERMINAL_KIND);
  const kind = data ? (mine.kind ?? suggestedKind) : null;
  // A folder that isn't a herdr workspace yet: the agent starts in a new workspace there.
  const folder = mine.folder ?? null;
  const workspaceId = data ? (mine.workspaceId ?? suggestedProject?.workspaceId ?? data.projects[0]?.workspaceId ?? null) : null;
  const newWorktree = mine.newWorktree ?? false;

  useEffect(() => {
    if (!source || !pane || sourceStatus !== "online" || handoff) return;
    source.client
      .call<HandoffResult>("shepherd.handoff", { paneId: pane })
      .then((result) => {
        setHandoff(result);
        if (result.available) setPrompt(result.brief);
      })
      .catch((err: HostCallError) =>
        setHandoff({
          available: false,
          reason: err.code === "invalid_message" || err.code === "unsupported" ? "Update Shepherd on the computer this agent is on to hand it off." : err.message,
        }),
      );
  }, [source, pane, sourceStatus, handoff]);

  useEffect(() => {
    if (!client || status !== "online") return;
    let cancelled = false;
    client
      .call<ProjectsResult>("shepherd.projects")
      .then((result) => {
        if (cancelled) return;
        setLoaded({ client, result });
        setFailure(null);
      })
      .catch((err: HostCallError) => {
        if (cancelled) return;
        setFailure({
          client,
          message:
            err.code === "invalid_message" || err.code === "unsupported"
              ? "Your host is out of date. Pull the latest Shepherd and restart the host."
              : err.message,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [client, status]);

  const start = async () => {
    if (!client || !kind || !(folder ?? workspaceId)) return;
    setStarting(true);
    try {
      const where = folder ? { folder } : { workspaceId: workspaceId!, newWorktree };
      const params: StartAgentParams = { kind, ...where, prompt: prompt.trim() || undefined };
      const result = await client.call<StartAgentResult>("shepherd.start_agent", params, { timeoutMs: START_TIMEOUT_MS });
      if (target && !target.active) await switchTo(target.host.id);
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
      <ScreenHeader title={handingOff ? "Hand off" : "New"} />

      {handoff && !handoff.available ? (
        <Text style={[type.body, styles.message, { color: colors.danger }]}>{handoff.reason}</Text>
      ) : error ? (
        <Text style={[type.body, styles.message, { color: colors.danger }]}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.muted} />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
            {handingOff ? (
              <View>
                <Text style={styles.groupLabel}>Computer</Text>
                <ListGroup>
                  <Select
                    title="Computer"
                    value={targetId}
                    onChange={setPicked}
                    options={computers.map((c, i) => ({
                      value: c.host.id,
                      label: states[i]?.host?.name ?? c.host.name ?? "Computer",
                      detail: c.host.id === from ? "Where the agent is now" : states[i]?.status === "online" ? null : "Offline",
                      icon: <Laptop size={19} color={colors.muted} />,
                    }))}
                  />
                </ListGroup>
                {handoff?.available && targetId !== from && leftBehind(handoff) ? (
                  <Text style={[styles.note, { color: colors.danger }]}>{leftBehind(handoff)}</Text>
                ) : null}
              </View>
            ) : null}

            <View>
              <Text style={styles.groupLabel}>Open</Text>
              <ListGroup>
                <Select
                  title="Open"
                  value={kind}
                  onChange={(k) => choose({ kind: k })}
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
                    choose({ folder: null, workspaceId: value });
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
                      trailing={<Toggle value={newWorktree} onValueChange={(v) => choose({ newWorktree: v })} />}
                    />
                  </>
                )}
              </ListGroup>
            </View>

            <View>
              <Text style={styles.groupLabel}>
                {handingOff ? "What it's told (edit freely)" : kind === TERMINAL_KIND ? "Command to run (optional)" : "First message (optional)"}
              </Text>
              {handingOff && !handoff ? <ActivityIndicator style={{ marginVertical: space.lg }} color={colors.muted} /> : null}
              <TextInput
                style={[styles.input, kind === TERMINAL_KIND && { fontFamily: fonts.mono, minHeight: 52 }, handingOff && styles.brief]}
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
              title={kind === TERMINAL_KIND ? "Open terminal" : starting ? `Starting ${kind}…` : handingOff ? `Hand off to ${kind ?? "agent"}` : `Start ${kind ?? "agent"}`}
              loading={starting}
              disabled={!kind || !(folder ?? workspaceId) || (handingOff && !handoff?.available)}
              onPress={start}
            />
          </View>
        </KeyboardAvoidingView>
      )}
      <FolderPicker client={client} visible={picking} onClose={() => setPicking(false)} onPick={(f) => choose({ folder: f })} />
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
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
  brief: { maxHeight: 320, fontSize: 13 },
  note: { ...type.sub, paddingHorizontal: space.lg + 4, paddingTop: 8 },
  terminalIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
}));
