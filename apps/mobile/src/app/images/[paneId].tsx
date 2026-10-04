import { useLocalSearchParams } from "expo-router";
import { Image as ImageIcon, RotateCw } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { ImageGroup, ImageRef, ImagesResult } from "@shepherd/protocol";
import { dayLabel, timeLabel } from "../../agents/activity";
import { agentName } from "../../agents/agents";
import { ImagesContext, ImageViewer, useImage } from "../../agents/ConversationImage";
import { useConnection, useHostState } from "../../connection/connection";
import { PressableScale } from "../../ui/Pressable";
import { Screen, ScreenHeader } from "../../ui/Screen";
import { colors, space, themed } from "../../ui/theme";

const COLUMNS = 3;
const GAP = 4;

function Tile({ image, size }: { image: ImageRef; size: number }) {
  const { uri, failed, load } = useImage(image);
  const [viewing, setViewing] = useState(false);
  return (
    <>
      <PressableScale
        onPress={() => (uri ? setViewing(true) : load())}
        style={[styles.tile, { width: size, height: size }]}
        accessibilityRole="imagebutton"
        accessibilityLabel={uri ? "Open the image" : failed ? "Couldn't load the image, tap to try again" : "Loading image"}
      >
        {uri ? (
          <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="cover" />
        ) : failed ? (
          <RotateCw size={18} color={colors.muted} />
        ) : (
          <ActivityIndicator color={colors.subtle} />
        )}
      </PressableScale>
      {viewing && uri ? <ImageViewer uri={uri} onClose={() => setViewing(false)} /> : null}
    </>
  );
}

function when(at: string | undefined): string | null {
  const t = at ? Date.parse(at) : NaN;
  if (Number.isNaN(t)) return null;
  const day = dayLabel(t);
  return day === "Today" ? timeLabel(t) : `${day}, ${new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function Group({ group, size }: { group: ImageGroup; size: number }) {
  const time = when(group.at);
  return (
    <View style={styles.group}>
      <View style={styles.groupHead}>
        <Text style={styles.message} numberOfLines={2}>
          {group.message ? `After “${group.message}”` : "Before your first message"}
        </Text>
        <Text style={styles.meta}>
          {group.images.length === 1 ? "1 image" : `${group.images.length} images`}
          {time ? ` · ${time}` : ""}
        </Text>
      </View>
      <View style={styles.grid}>
        {group.images.map((image) => (
          <Tile key={image.id} image={image} size={size} />
        ))}
      </View>
    </View>
  );
}

/** Every image in an agent's conversation, newest first, under the message of yours each came after. */
export default function ImagesScreen() {
  const { paneId } = useLocalSearchParams<{ paneId: string }>();
  const { client } = useConnection();
  const state = useHostState();
  const agent = state.agents.find((a) => a.pane_id === paneId) ?? null;
  const [result, setResult] = useState<ImagesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const size = Math.floor((width - space.lg * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

  useEffect(() => {
    if (!client || !paneId) return;
    let current = true;
    client
      .call<ImagesResult>("shepherd.images", { paneId })
      .then((r) => current && setResult(r))
      .catch((err: Error) => current && setError(err.message));
    return () => {
      current = false;
    };
  }, [client, paneId]);

  // The page loads every image it shows, whatever "Show images" says.
  const session = result?.available ? result.session : null;
  const images = useMemo(() => ({ client, paneId: paneId ?? "", session, auto: true }), [client, paneId, session]);
  const total = result?.available ? result.groups.reduce((n, g) => n + g.images.length, 0) : 0;

  return (
    <Screen>
      <ScreenHeader title="Images" meta={[agent ? agentName(agent) : null, total ? `${total} in this conversation` : null].filter(Boolean).join(" · ")} />
      {error || (result && !result.available) ? (
        <Text style={styles.empty}>{error ?? (result && !result.available ? result.reason : "")}</Text>
      ) : !result ? (
        <ActivityIndicator style={styles.loading} color={colors.subtle} />
      ) : result.groups.length === 0 ? (
        <View style={styles.emptyBox}>
          <ImageIcon size={28} color={colors.subtle} />
          <Text style={styles.empty}>No images in this conversation yet. Screenshots and pictures the agent reads, and images you paste, show up here.</Text>
        </View>
      ) : (
        <ImagesContext.Provider value={images}>
          <FlatList
            data={result.groups}
            keyExtractor={(g, i) => `${i}:${g.images[0]?.id}`}
            renderItem={({ item }) => <Group group={item} size={size} />}
            contentContainerStyle={styles.list}
            initialNumToRender={4}
            windowSize={5}
          />
        </ImagesContext.Provider>
      )}
    </Screen>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    meta: { fontSize: 12.5, color: colors.muted },
    list: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.xl },
    group: { gap: space.sm },
    groupHead: { gap: 2 },
    message: { fontSize: 14, lineHeight: 20, color: colors.text },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
    tile: { borderRadius: 8, overflow: "hidden", backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
    loading: { marginTop: space.xxl },
    emptyBox: { alignItems: "center", gap: space.md, marginTop: space.xxl, paddingHorizontal: space.xl },
    empty: { fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: "center", padding: space.lg },
  }),
);
