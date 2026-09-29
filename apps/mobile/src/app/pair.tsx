import { useLinkingURL } from "expo-linking";
import { Redirect } from "expo-router";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, Text } from "react-native";
import { parsePairingLink } from "@sheperd/protocol";
import { usePairing } from "../connection/use-pairing";
import { Screen } from "../ui/Screen";
import { colors, type } from "../ui/theme";

/** Handles sheperd://pair?… when the QR code is scanned with the phone's own camera. */
export default function PairScreen() {
  const url = useLinkingURL();
  const pair = usePairing();
  const info = useMemo(() => (url ? parsePairingLink(url) : null), [url]);

  useEffect(() => {
    if (info) void pair(info);
  }, [info, pair]);

  if (url && !info) return <Redirect href="/connect" />;
  return (
    <Screen style={{ alignItems: "center", justifyContent: "center", gap: 12 }}>
      <ActivityIndicator color={colors.muted} />
      <Text style={type.sub}>Pairing…</Text>
    </Screen>
  );
}
