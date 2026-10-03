import { Image as ImageIcon, X } from "lucide-react-native";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Animated, Image, Modal, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import type { ImageRef, ImageResult } from "@shepherd/protocol";
import type { HostConnection } from "../connection/host-client";
import { IconButton } from "../ui/IconButton";
import { PressableScale } from "../ui/Pressable";
import { colors, space, themed } from "../ui/theme";

/** Where a conversation's images come from, and whether to load them as they appear. */
export const ImagesContext = createContext<{ client: HostConnection | null; paneId: string; session: string | null; auto: boolean } | null>(null);

const MAX_PREVIEW = 260;
const MAX_CACHED = 30;
/** Images already loaded this session (as data URIs), newest last. */
const cache = new Map<string, string>();

async function fetchImage(client: HostConnection, paneId: string, id: string): Promise<string> {
  let data = "";
  let mime = "image/png";
  for (let from = 0, total = Infinity; from < total; ) {
    const chunk = await client.call<ImageResult>("shepherd.image", { paneId, id, from });
    if (!chunk.available) throw new Error(chunk.reason);
    if (!chunk.data.length) break;
    data += chunk.data;
    mime = chunk.mime;
    total = chunk.total;
    from += chunk.data.length;
  }
  return `data:${mime};base64,${data}`;
}

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function ImageThumb({ image }: { image: ImageRef }) {
  const ctx = useContext(ImagesContext);
  const key = `${ctx?.paneId}:${ctx?.session}:${image.id}`;
  const [loaded, setLoaded] = useState<{ key: string; uri: string } | null>(() => (cache.has(key) ? { key, uri: cache.get(key)! } : null));
  const [failed, setFailed] = useState<string | null>(null);
  const [tapped, setTapped] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [viewing, setViewing] = useState(false);
  const inflight = useRef(false);
  const uri = loaded?.key === key ? loaded.uri : cache.get(key) ?? null;
  const wanted = Boolean(ctx?.auto) || tapped;

  useEffect(() => {
    if (!wanted || uri || inflight.current || !ctx?.client) return;
    inflight.current = true;
    fetchImage(ctx.client, ctx.paneId, image.id)
      .then((data) => {
        cache.delete(key);
        cache.set(key, data);
        while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
        setLoaded({ key, uri: data });
      })
      .catch((err: Error) => setFailed(err.message))
      .finally(() => (inflight.current = false));
  }, [wanted, uri, ctx, image.id, key]);

  useEffect(() => {
    if (!uri) return;
    let current = true;
    Image.getSize(
      uri,
      (width, height) => current && width > 0 && height > 0 && setSize({ width, height }),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [uri]);

  if (!uri) {
    const label = failed ? "Couldn't load the image" : wanted ? "Loading image…" : `Image · ${kb(image.bytes)}`;
    return (
      <PressableScale onPress={() => setTapped(true)} disabled={wanted && !failed} style={styles.placeholder} accessibilityRole="button" accessibilityLabel={label}>
        <ImageIcon size={15} color={colors.muted} />
        <Text style={styles.placeholderText}>{label}</Text>
      </PressableScale>
    );
  }
  const scale = size ? Math.min(1, MAX_PREVIEW / Math.max(size.width, size.height)) : 1;
  return (
    <>
      <PressableScale onPress={() => setViewing(true)} accessibilityRole="imagebutton" accessibilityLabel="Open the image">
        <Image
          source={{ uri }}
          style={[styles.preview, size ? { width: size.width * scale, height: size.height * scale } : { width: MAX_PREVIEW, height: 160 }]}
          resizeMode="contain"
        />
      </PressableScale>
      {viewing ? <ImageViewer uri={uri} onClose={() => setViewing(false)} /> : null}
    </>
  );
}

/** A message's or tool result's images, one under the other. */
export function ConversationImages({ images, align = "start" }: { images: ImageRef[]; align?: "start" | "end" }) {
  return (
    <View style={[styles.images, { alignItems: align === "end" ? "flex-end" : "flex-start" }]}>
      {images.map((image) => (
        <ImageThumb key={image.id} image={image} />
      ))}
    </View>
  );
}

const distance = (e: GestureResponderEvent) => {
  const [a, b] = e.nativeEvent.touches;
  return a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0;
};

/** Full screen: pinch to zoom, drag to move around, double-tap to zoom in or out. */
function ImageViewer({ uri, onClose }: { uri: string; onClose: () => void }) {
  const [scale] = useState(() => new Animated.Value(1));
  const [pan] = useState(() => new Animated.ValueXY({ x: 0, y: 0 }));
  const current = useRef({ scale: 1, x: 0, y: 0 });
  const gesture = useRef<{ distance: number; scale: number; x: number; y: number; pageX: number; pageY: number } | null>(null);
  const lastTap = useRef(0);

  const set = (next: { scale: number; x: number; y: number }) => {
    current.current = next;
    scale.setValue(next.scale);
    pan.setValue({ x: next.x, y: next.y });
  };
  const start = (e: GestureResponderEvent) => {
    const touch = e.nativeEvent.touches[0];
    gesture.current = { distance: distance(e), ...current.current, pageX: touch?.pageX ?? 0, pageY: touch?.pageY ?? 0 };
  };

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View
        style={styles.viewer}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => {
          const now = Date.now();
          if (now - lastTap.current < 280) set(current.current.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 });
          lastTap.current = now;
          start(e);
        }}
        onResponderMove={(e) => {
          const g = gesture.current;
          if (!g) return;
          if (e.nativeEvent.touches.length === 2) {
            if (!g.distance) return start(e);
            set({ ...current.current, scale: Math.min(5, Math.max(1, (g.scale * distance(e)) / g.distance)) });
          } else if (current.current.scale > 1) {
            const touch = e.nativeEvent.touches[0];
            if (touch) set({ ...current.current, x: g.x + touch.pageX - g.pageX, y: g.y + touch.pageY - g.pageY });
          }
        }}
        onResponderRelease={() => {
          gesture.current = null;
          if (current.current.scale <= 1.05) set({ scale: 1, x: 0, y: 0 });
        }}
      >
        <Animated.Image
          source={{ uri }}
          resizeMode="contain"
          style={[styles.full, { transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale }] }]}
        />
      </View>
      <View style={styles.close}>
        <IconButton label="Close" onPress={onClose}>
          <X size={20} color="#FFFFFF" />
        </IconButton>
      </View>
    </Modal>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    images: { gap: space.sm, marginTop: 6 },
    placeholder: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.raised, alignSelf: "flex-start" },
    placeholderText: { fontSize: 12.5, color: colors.muted },
    preview: { borderRadius: 10, backgroundColor: colors.raised },
    viewer: { flex: 1, backgroundColor: "#000000", alignItems: "center", justifyContent: "center" },
    full: { width: "100%", height: "100%" },
    close: { position: "absolute", top: 44, right: 16 },
  }),
);
