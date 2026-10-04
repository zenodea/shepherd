import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { QueuedMessage } from "@shepherd/protocol";
import { Conversation } from "../../../agents/Conversation";
import { ImagesContext } from "../../../agents/ConversationImage";
import { useImagesShown } from "../../../agents/image-setting";
import { SubagentsContext } from "../../../agents/SubagentCard";
import { subagentStatusColor, subagentStatusLabel, subagentTime } from "../../../agents/subagents";
import { useConversation } from "../../../agents/use-conversation";
import { useConnection, useHostState } from "../../../connection/connection";
import { ConnectionBanner } from "../../../ui/ConnectionBanner";
import { Screen, ScreenHeader } from "../../../ui/Screen";
import { colors, space, themed } from "../../../ui/theme";

const NO_QUEUE: QueuedMessage[] = [];

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
      <ScreenHeader
        title={subagent?.name ?? "Subagent"}
        meta={
          subagent ? (
            <>
              <Text style={{ color: subagentStatusColor(subagent.status) }}>{subagentStatusLabel[subagent.status]}</Text>
              {details ? `  ·  ${details}` : ""}
            </>
          ) : null
        }
      />
      <ConnectionBanner />
      {conversation.available === false ? (
        <Text style={styles.empty}>{conversation.reason}</Text>
      ) : (
        <View style={{ flex: 1 }}>
          <SubagentsContext.Provider value={links}>
            <ImagesContext.Provider value={images}>
              <Conversation
                entries={conversation.entries}
                queued={NO_QUEUE}
                ready={conversation.available === true}
                working={subagent?.status === "running"}
                activity={subagent?.status === "running" ? subagent.doing : null}
                atStart={conversation.atStart}
                loadingOlder={conversation.loadingOlder}
                onLoadOlder={conversation.loadOlder}
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
    empty: { fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: "center", padding: space.lg },
  }),
);
