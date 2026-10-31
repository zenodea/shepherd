import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Check, ClipboardCopy, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AgentCopy } from "@shepherd/protocol";
import { useConnection } from "../connection/connection";
import { PressableScale } from "../ui/Pressable";
import { colors, fonts, radii, space, themed } from "../ui/theme";
import { agentName } from "./agents";

/** Long enough to reach for the phone after the agent copies something. */
const SHOW_MS = 20_000;
const COPIED_MS = 1200;

/**
 * When a program in an agent's pane copies text on the computer (Rex reports
 * it), offer it here to copy on the phone: a link, a command, a branch name.
 * The phone's clipboard changes only when you tap Copy.
 */
export function CopiedBanner() {
  const { client } = useConnection();
  const insets = useSafeAreaInsets();
  const [copy, setCopy] = useState<(AgentCopy & { from: string }) | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideIn = (ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopy(null), ms);
  };

  useEffect(() => {
    if (!client) return;
    const unsubscribe = client.onCopied((next) => {
      const agent = client.getState().agents.find((a) => a.pane_id === next.paneId);
      setCopied(false);
      setCopy({ ...next, from: agent ? agentName(agent) : "An agent" });
      hideIn(SHOW_MS);
    });
    return () => {
      unsubscribe();
      setCopy(null);
    };
  }, [client]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (!copy) return null;

  const take = () => {
    void Clipboard.setStringAsync(copy.text).then(() => {
      if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setCopied(true);
      hideIn(COPIED_MS);
    });
  };

  return (
    <View style={[styles.wrap, { top: insets.top + space.sm }]} pointerEvents="box-none">
      <View style={styles.card} accessibilityLiveRegion="polite">
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title} numberOfLines={1}>
            {copy.from} copied{copy.truncated ? " (the start of it)" : ""}
          </Text>
          <Text style={styles.text} numberOfLines={2}>
            {copy.text.trim()}
          </Text>
        </View>
        <PressableScale style={styles.copy} onPress={take} accessibilityRole="button" accessibilityLabel={copied ? "Copied" : "Copy to this phone"}>
          {copied ? <Check size={16} color={colors.text} /> : <ClipboardCopy size={16} color={colors.text} />}
          <Text style={styles.copyText}>{copied ? "Copied" : "Copy"}</Text>
        </PressableScale>
        <PressableScale style={styles.close} onPress={() => setCopy(null)} accessibilityRole="button" accessibilityLabel="Dismiss">
          <X size={16} color={colors.muted} />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    wrap: { position: "absolute", left: space.md, right: space.md, zIndex: 100 },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.sm,
      paddingLeft: space.md,
      paddingRight: space.xs,
      paddingVertical: space.sm,
      borderRadius: radii.lg,
      backgroundColor: colors.floating,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    title: { fontSize: 13, color: colors.muted, fontWeight: "500" },
    text: { fontSize: 13, color: colors.text, fontFamily: fonts.mono },
    copy: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.surface },
    copyText: { fontSize: 13, color: colors.text, fontWeight: "600" },
    close: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  }),
);
