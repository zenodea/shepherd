import { Check, Download, Image as ImageIcon, X } from "lucide-react-native";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Image, Modal, Platform, StyleSheet, Text, useWindowDimensions, View, type GestureResponderEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Background from "../../modules/shepherd-background/src/ShepherdBackgroundModule";
import type { ImageRef, ImageResult } from "@shepherd/protocol";
import type { HostConnection } from "../connection/host-client";
import { IconButton } from "../ui/IconButton";
import { PressableScale } from "../ui/Pressable";
import { colors, space, themed } from "../ui/theme";
import { IDENTITY, clampView, fitted, pinch, toggleZoom, type Point, type ZoomView } from "./zoom";

const native = Platform.OS !== "web";

/** Where a conversation's images come from, and whether to load them as they appear. */
export const ImagesContext = createContext<{ client: HostConnection | null; paneId: string; session: string | null; auto: boolean } | null>(null);

const MAX_PREVIEW = 260;
const MAX_CACHED = 30;
/** Images already loaded this session (as data URIs), newest last. */
const cache = new Map<string, string>();
/** Images you tapped to load: they stay shown with "Show images" off. */
const opened = new Set<string>();

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

/**
 * An image's data URI once loaded, when it's wanted: "Show images" is on, or
 * you tapped it (`load`). Loaded images are shared through a small cache.
 */
export function useImage(image: ImageRef) {
  const ctx = useContext(ImagesContext);
  const key = `${ctx?.paneId}:${ctx?.session}:${image.id}`;
  const [loaded, setLoaded] = useState<{ key: string; uri: string } | null>(() => (cache.has(key) ? { key, uri: cache.get(key)! } : null));
  const [failed, setFailed] = useState<string | null>(null);
  const [tapped, setTapped] = useState(() => opened.has(key));
  const [attempt, setAttempt] = useState(0);
  const inflight = useRef(false);
  const wanted = Boolean(ctx?.auto) || tapped || opened.has(key);
  // Loaded before but not wanted now (the setting was turned off): show the placeholder.
  const uri = wanted ? (loaded?.key === key ? loaded.uri : (cache.get(key) ?? null)) : null;

  useEffect(() => {
    if (!wanted || uri || inflight.current || !ctx?.client) return;
    inflight.current = true;
    setFailed(null);
    fetchImage(ctx.client, ctx.paneId, image.id)
      .then((data) => {
        cache.delete(key);
        cache.set(key, data);
        while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
        setLoaded({ key, uri: data });
      })
      .catch((err: Error) => setFailed(err.message))
      .finally(() => (inflight.current = false));
  }, [wanted, uri, ctx, image.id, key, attempt]);

  const load = () => {
    opened.add(key);
    setTapped(true);
    setAttempt((a) => a + 1);
  };
  return { uri, wanted, failed, load };
}

function ImageThumb({ image }: { image: ImageRef }) {
  const { uri, wanted, failed, load } = useImage(image);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [viewing, setViewing] = useState(false);

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
    const label = failed ? "Couldn't load the image · tap to try again" : wanted ? "Loading image…" : `Image · ${kb(image.bytes)}`;
    return (
      <PressableScale onPress={load} disabled={wanted && !failed} style={styles.placeholder} accessibilityRole="button" accessibilityLabel={label}>
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

type Touches = GestureResponderEvent["nativeEvent"]["touches"];
const fingerDistance = (t: Touches) => (t.length >= 2 ? Math.hypot(t[0]!.pageX - t[1]!.pageX, t[0]!.pageY - t[1]!.pageY) : 0);

/** Saves a data URI: into Pictures/Shepherd on the phone, as a download on the web. */
async function saveImage(uri: string): Promise<string> {
  const match = /^data:(image\/([\w.+-]+));base64,(.*)$/s.exec(uri);
  if (!match) throw new Error("This image can't be saved.");
  const [, mime, type, data] = match as unknown as [string, string, string, string];
  const name = `shepherd-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.${type === "jpeg" ? "jpg" : type.replace(/\+.*/, "")}`;
  if (Platform.OS === "web") {
    const link = document.createElement("a");
    link.href = uri;
    link.download = name;
    link.click();
    return "Downloaded";
  }
  if (!Background) throw new Error("Saving needs the Shepherd app, not Expo Go.");
  await Background.saveImage(data, mime, name);
  return "Saved to Pictures/Shepherd";
}

/**
 * Full screen. Pinch to zoom into what's between your fingers, drag to move
 * around, double-tap to zoom in on a spot (or back out), swipe down to close.
 */
export function ImageViewer({ uri, onClose }: { uri: string; onClose: () => void }) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [anim] = useState(() => ({ scale: new Animated.Value(1), x: new Animated.Value(0), y: new Animated.Value(0), dismiss: new Animated.Value(0) }));
  const view = useRef<ZoomView>(IDENTITY);
  const gesture = useRef<{ fingers: number; view: ZoomView; focal: Point; distance: number; start: Point; at: number; moved: boolean } | null>(null);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);
  const [saved, setSaved] = useState<{ text: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const size = { width: window.width, height: window.height };
  // The picture's own size, so panning stops at its edges rather than the screen's.
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    let current = true;
    Image.getSize(
      uri,
      (width, height) => current && setNatural({ width, height }),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [uri]);
  const picture = fitted(natural, size);

  const point = (t: { pageX: number; pageY: number }): Point => ({ x: t.pageX - window.width / 2, y: t.pageY - window.height / 2 });
  const focal = (t: Touches): Point => (t.length >= 2 ? point({ pageX: (t[0]!.pageX + t[1]!.pageX) / 2, pageY: (t[0]!.pageY + t[1]!.pageY) / 2 }) : point(t[0]!));
  const show = (next: ZoomView) => {
    view.current = next;
    anim.scale.setValue(next.scale);
    anim.x.setValue(next.x);
    anim.y.setValue(next.y);
  };
  const settle = (next: ZoomView) => {
    view.current = next;
    const spring = (v: Animated.Value, to: number) => Animated.spring(v, { toValue: to, friction: 9, tension: 90, useNativeDriver: native });
    Animated.parallel([spring(anim.scale, next.scale), spring(anim.x, next.x), spring(anim.y, next.y), spring(anim.dismiss, 0)]).start();
  };
  const begin = (t: Touches, keepTap = false) => {
    gesture.current = {
      fingers: t.length,
      view: view.current,
      focal: focal(t),
      distance: fingerDistance(t),
      start: point(t[0]!),
      at: keepTap && gesture.current ? gesture.current.at : Date.now(),
      moved: keepTap && gesture.current ? gesture.current.moved : false,
    };
  };

  const download = () => {
    if (saving) return;
    setSaving(true);
    saveImage(uri)
      .then((text) => setSaved({ text, ok: true }))
      .catch((err: Error) => setSaved({ text: err.message, ok: false }))
      .finally(() => {
        setSaving(false);
        setTimeout(() => setSaved(null), 2500);
      });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.viewer, { opacity: anim.dismiss.interpolate({ inputRange: [0, 300], outputRange: [1, 0.35], extrapolate: "clamp" }) }]} />
      <View
        style={StyleSheet.absoluteFill}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => begin(e.nativeEvent.touches)}
        onResponderMove={(e) => {
          const t = e.nativeEvent.touches;
          const g = gesture.current;
          if (!g || t.length === 0) return;
          // A finger added or lifted: carry on from where things are now.
          if (t.length !== g.fingers) return begin(t, true);
          if (t.length >= 2) {
            g.moved = true;
            return show(pinch(g.view, { focal: g.focal, distance: g.distance }, { focal: focal(t), distance: fingerDistance(t) }));
          }
          const p = point(t[0]!);
          const dx = p.x - g.start.x;
          const dy = p.y - g.start.y;
          if (Math.hypot(dx, dy) > 8) g.moved = true;
          if (g.view.scale > 1.01) show({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
          else if (g.moved) {
            // Not zoomed in: dragging moves the picture along, to swipe it away.
            anim.x.setValue(dx * 0.4);
            anim.y.setValue(dy);
            anim.dismiss.setValue(Math.abs(dy));
          }
        }}
        onResponderRelease={(e) => {
          const g = gesture.current;
          gesture.current = null;
          if (!g) return;
          const p = point(e.nativeEvent.changedTouches[0] ?? { pageX: window.width / 2, pageY: window.height / 2 });
          if (!g.moved && Date.now() - g.at < 300) {
            const last = lastTap.current;
            if (last && Date.now() - last.at < 320 && Math.hypot(p.x - last.point.x, p.y - last.point.y) < 40) {
              lastTap.current = null;
              return settle(toggleZoom(view.current, p, size, picture));
            }
            lastTap.current = { at: Date.now(), point: p };
            return;
          }
          if (view.current.scale <= 1.01 && g.view.scale <= 1.01 && Math.abs(p.y - g.start.y) > 120) return onClose();
          settle(clampView(view.current, size, picture));
        }}
      >
        <Animated.Image
          source={{ uri }}
          resizeMode="contain"
          style={[styles.full, { transform: [{ translateX: anim.x }, { translateY: anim.y }, { scale: anim.scale }] }]}
        />
      </View>
      <View style={[styles.actions, { top: insets.top + 8 }]}>
        <IconButton label="Save image" onPress={download} filled={false}>
          {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Download size={20} color="#FFFFFF" />}
        </IconButton>
        <IconButton label="Close" onPress={onClose} filled={false}>
          <X size={22} color="#FFFFFF" />
        </IconButton>
      </View>
      {saved ? (
        <View style={[styles.toast, { bottom: insets.bottom + 28 }]} pointerEvents="none">
          {saved.ok ? <Check size={15} color="#FFFFFF" /> : null}
          <Text style={styles.toastText}>{saved.text}</Text>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    images: { gap: space.sm, marginTop: 6 },
    placeholder: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.raised, alignSelf: "flex-start" },
    placeholderText: { fontSize: 12.5, color: colors.muted },
    preview: { borderRadius: 10, backgroundColor: colors.raised },
    viewer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000000" },
    full: { width: "100%", height: "100%" },
    actions: { position: "absolute", right: 12, flexDirection: "row", gap: 4, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 999 },
    toast: {
      position: "absolute",
      alignSelf: "center",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 999,
      backgroundColor: "rgba(40,40,40,0.92)",
    },
    toastText: { color: "#FFFFFF", fontSize: 13.5 },
  }),
);
