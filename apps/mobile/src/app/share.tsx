import { Redirect, useNavigation, useRouter } from "expo-router";
import { Check, Laptop } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Keyboard, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { AgentInfo } from "@shepherd/protocol";
import Background, { type SharedContent } from "../../modules/shepherd-background/src/ShepherdBackgroundModule";
import { agentName, agentTitle, projectOf } from "../agents/agents";
import { imageMime, upload } from "../agents/attachments";
import { useConnection, useHostState } from "../connection/connection";
import { HostCallError, type HostConnection } from "../connection/host-client";
import { shareMessage, sharedText } from "../share/share-message";
import { setShared, useShared } from "../share/share-store";
import { ActionSheet } from "../ui/ActionSheet";
import { AgentMark } from "../ui/AgentMark";
import { Button } from "../ui/Button";
import { ConnectionBanner } from "../ui/ConnectionBanner";
import { IconButton } from "../ui/IconButton";
import { PressableScale } from "../ui/Pressable";
import { Screen, ScreenHeader, SectionHeader } from "../ui/Screen";
import { StatusIndicator } from "../ui/StatusIndicator";
import { colors, radii, space, statusColors, statusLabels, statusRank, type, themed } from "../ui/theme";

/** Something shared from another app: pick the agent it goes to, with an optional note. */
export default function ShareScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { settings, hosts, client, switchTo } = useConnection();
  const state = useHostState();
  const live = useShared();
  // Kept while this screen is open, even after it's sent; a newer share replaces it.
  const [shared, setKept] = useState(live);
  if (live && live !== shared) setKept(live);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [hostSheet, setHostSheet] = useState(false);
  const online = state.status === "online";

  // Leaving without sending drops it.
  useEffect(() => navigation.addListener("beforeRemove", () => setShared(null)), [navigation]);

  // The images go to the computer in use as soon as it's connected, so sending is quick.
  const uploaded = useRef<{ shared: SharedContent; client: HostConnection; paths: Promise<string[]> } | null>(null);
  const uploadImages = useCallback(
    (to: HostConnection): Promise<string[]> => {
      if (!shared?.images.length) return Promise.resolve([]);
      const done = uploaded.current;
      if (done && done.shared === shared && done.client === to) return done.paths;
      const paths = Promise.all(
        shared.images.map(async (uri) => {
          if (!Background) throw new Error("Couldn't read that image.");
          return upload(to, await Background.readSharedImage(uri), imageMime(uri));
        }),
      );
      uploaded.current = { shared, client: to, paths };
      // Try again on the next send.
      paths.catch(() => {
        if (uploaded.current?.paths === paths) uploaded.current = null;
      });
      return paths;
    },
    [shared],
  );
  useEffect(() => {
    if (online && client) uploadImages(client).catch(() => {});
  }, [online, client, uploadImages]);

  const agents = useMemo(
    () => [...state.agents].sort((a, b) => statusRank[a.agent_status] - statusRank[b.agent_status] || a.pane_id.localeCompare(b.pane_id)),
    [state.agents],
  );

  if (!shared) return <Redirect href="/" />;

  const send = async (agent: AgentInfo) => {
    if (!client || sending) return;
    Keyboard.dismiss();
    setSending(agent.pane_id);
    try {
      const paths = await uploadImages(client);
      await client.call("agent.prompt", { target: agent.pane_id, text: shareMessage(note, shared, paths) });
      router.replace({ pathname: "/agent/[paneId]", params: { paneId: agent.pane_id } });
      setShared(null);
    } catch (err) {
      // herdr won't type a message into an agent that's waiting for an answer: it would become the answer.
      if (err instanceof HostCallError && err.code === "agent_blocked") {
        Alert.alert(`${agentName(agent)} is waiting for an answer`, "Answer its question first, or send this to another agent.");
      } else {
        Alert.alert("Couldn't send", (err as Error).message);
      }
    } finally {
      setSending(null);
    }
  };

  const text = sharedText(shared);
  const hostName = state.host?.name ?? settings?.name ?? "Computer";

  return (
    <Screen>
      <ScreenHeader
        title="Send to an agent"
        meta={settings ? hostName : undefined}
        metaIcon={<Laptop size={12} color={colors.muted} />}
        right={
          hosts.length > 1 ? (
            <IconButton label="Switch computer" onPress={() => setHostSheet(true)} filled={false}>
              <Laptop size={19} color={colors.muted} />
            </IconButton>
          ) : null
        }
      />
      {settings ? <ConnectionBanner /> : null}

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.xxl * 2 }}>
        <View style={styles.preview}>
          {shared.images.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.images}>
              {shared.images.map((uri) => (
                <Image key={uri} source={{ uri }} style={styles.image} accessibilityLabel="Shared image" />
              ))}
            </ScrollView>
          ) : null}
          {text ? (
            <Text style={styles.text} numberOfLines={4}>
              {text}
            </Text>
          ) : null}
          {shared.failed ? (
            <Text style={type.caption}>
              {shared.failed === 1 ? "An image couldn't be read." : `${shared.failed} images couldn't be read.`}
            </Text>
          ) : null}
        </View>

        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a note…"
          placeholderTextColor={colors.subtle}
          style={styles.note}
          returnKeyType="done"
          accessibilityLabel="Note"
        />

        {settings === null ? (
          <View style={styles.empty}>
            <Text style={type.title}>Pair with your computer first</Text>
            <Text style={[type.sub, { textAlign: "center" }]}>Then share this again.</Text>
            <Button title="Pair" onPress={() => router.replace("/connect")} style={{ marginTop: space.md, alignSelf: "stretch" }} />
          </View>
        ) : !online ? (
          <Text style={[type.sub, styles.waiting]}>This stays here until your computer is connected.</Text>
        ) : agents.length === 0 ? (
          <View style={styles.empty}>
            <Text style={type.title}>No agents running</Text>
            <Text style={[type.sub, { textAlign: "center" }]}>Start one from the home screen, or in herdr on your computer.</Text>
          </View>
        ) : (
          <>
            <SectionHeader title="Agents" count={agents.length} />
            {agents.map((agent) => (
              <AgentRow
                key={agent.pane_id}
                agent={agent}
                sending={sending === agent.pane_id}
                disabled={sending !== null}
                onPress={() => void send(agent)}
              />
            ))}
          </>
        )}
      </ScrollView>

      <ActionSheet
        visible={hostSheet}
        title="Computers"
        onClose={() => setHostSheet(false)}
        actions={hosts.map((host) => {
          const active = host.id === settings?.id;
          return {
            key: host.id,
            icon: <Laptop size={19} color={colors.text} />,
            title: active ? hostName : (host.name ?? "Computer"),
            trailing: active ? <Check size={18} color={colors.text} /> : null,
            onPress: () => void switchTo(host.id),
          };
        })}
      />
    </Screen>
  );
}

function AgentRow({ agent, sending, disabled, onPress }: { agent: AgentInfo; sending: boolean; disabled: boolean; onPress: () => void }) {
  const title = agentTitle(agent) ?? agentName(agent);
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      style={[styles.row, disabled && !sending && { opacity: 0.5 }]}
      accessibilityRole="button"
      accessibilityLabel={`Send to ${title}, ${agentName(agent)}, ${statusLabels[agent.agent_status]}`}
      accessibilityState={{ busy: sending, disabled }}
    >
      <AgentMark agent={agent.agent} size={32} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={type.row} numberOfLines={1}>
          {title}
        </Text>
        <Text style={type.sub} numberOfLines={1}>
          <Text style={{ color: agent.agent_status === "idle" ? colors.subtle : statusColors[agent.agent_status] }}>
            {statusLabels[agent.agent_status]}
          </Text>
          {`  ·  ${agentName(agent)}  ·  ${projectOf(agent)}`}
        </Text>
      </View>
      <View style={styles.statusSlot}>
        {sending ? <ActivityIndicator size="small" color={colors.muted} /> : <StatusIndicator status={agent.agent_status} />}
      </View>
    </PressableScale>
  );
}

const styles = themed(() => StyleSheet.create({
  preview: { marginHorizontal: space.lg, marginTop: space.sm, gap: space.md },
  images: { gap: space.sm },
  image: { width: 72, height: 72, borderRadius: radii.md, backgroundColor: colors.raised },
  text: { fontSize: 14, lineHeight: 20, color: colors.muted },
  note: {
    marginHorizontal: space.lg,
    marginTop: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    height: 48,
  },
  waiting: { paddingHorizontal: space.lg, paddingTop: space.xl, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 11 },
  statusSlot: { width: 24, alignItems: "center" },
  empty: { alignItems: "center", gap: 6, paddingHorizontal: space.xl, paddingTop: 60 },
}));
