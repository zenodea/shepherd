import { useLinkingURL } from "expo-linking";
import { Redirect } from "expo-router";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { parsePairingLink } from "@sheperd/protocol";
import { usePairing } from "../connection/use-pairing";
import { usePalette } from "../ui/theme";

/** Handles sheperd://pair?… when the QR code is scanned with the phone's own camera. */
export default function PairScreen() {
  const palette = usePalette();
  const url = useLinkingURL();
  const pair = usePairing();
  const info = useMemo(() => (url ? parsePairingLink(url) : null), [url]);

  useEffect(() => {
    if (info) void pair(info);
  }, [info, pair]);

  if (url && !info) return <Redirect href="/connect" />;
  return (
    <View style={styles.center}>
      <ActivityIndicator />
      <Text style={{ color: palette.muted }}>Pairing…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
});
