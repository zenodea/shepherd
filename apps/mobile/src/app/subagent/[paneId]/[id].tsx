import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Conversation } from "../../../agents/Conversation";
import { ImagesContext } from "../../../agents/ConversationImage";
import { useImagesShown } from "../../../agents/image-setting";
import { SubagentsContext } from "../../../agents/SubagentCard";
import { subagentStatusColor, subagentStatusLabel, subagentTime } from "../../../agents/subagents";
import { useConversation } from "../../../agents/use-conversation";
import { useConnection, useHostState } from "../../../connection/connection";
import { Banner, Screen } from "../../../ui/Screen";
import { IconButton } from "../../../ui/IconButton";
import { colors, space, themed } from "../../../ui/theme";

/** A subagent's own conversation: what it was asked, each step, and what it reported back. Read-only. */
export default function SubagentScreen() {
  const router = useRouter();
  const { paneId, id } = useLocalSearchParams<{ paneId: string; id: string }>();
  const { client } = useConnection();
  const state = useHostState();
  const online = state.status === "online";
  const conversation = useConversation(client, paneId ?? null, online, id ?? null);
  const subagent = conversation.subagents.find((s) => s.id === id) ?? null;
  const imagesShown = useImagesShown();

  const images = useMemo(
    () => ({ client, paneId: paneId ?? "", subagent: id ?? null, session: conversation.session, auto: imagesShown }),
    [client, paneId, id, conversation.session, imagesShown],
  );
  const links = useMemo(
    () => ({
      byId: new Map(conversation.subagents.map((s) => [s.id, s])),
      open: (other: string) => router.push({ pathname: "/subagent/[paneId]/[id]", params: { paneId: paneId!, id: other } }),
    }),
    [conversation.subagents, router, paneId],
  );

  const details = subagent ? [subagent.kind, subagentTime(subagent)].filter(Boolean).join("  ·  ") : "";

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
          <ChevronLeft size={22} color={colors.text} />
        </IconButton>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {subagent?.name ?? "Subagent"}
          </Text>
          {subagent ? (
            <Text style={styles.meta} numberOfLines={1}>
              <Text style={{ color: subagentStatusColor(subagent.status) }}>{subagentStatusLabel[subagent.status]}</Text>
              {details ? `  ·  ${details}` : ""}
            </Text>
          ) : null}
        </View>
      </View>
      {!online ? <Banner>{state.status === "connecting" ? "Connecting…" : "Can't reach your computer. Retrying…"}</Banner> : null}
      {conversation.available === false ? (
        <Text style={styles.empty}>{conversation.reason}</Text>
      ) : (
        <View style={{ flex: 1 }}>
          <SubagentsContext.Provider value={links}>
            <ImagesContext.Provider value={images}>
              <Conversation
                entries={conversation.entries}
                queued={[]}
                ready={conversation.available === true}
                working={subagent?.status === "running"}
                activity={subagent?.status === "running" ? subagent.doing : null}
                atStart={conversation.atStart}
                loadingOlder={conversation.loadingOlder}
                onLoadOlder={() => void conversation.loadOlder()}
              />
            </ImagesContext.Provider>
          </SubagentsContext.Provider>
        </View>
      )}
    </Screen>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
    title: { fontSize: 16, fontWeight: "600", color: colors.text },
    meta: { fontSize: 12.5, color: colors.muted },
    empty: { fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: "center", padding: space.lg },
  }),
);
