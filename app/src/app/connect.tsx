import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { normaliseHostUrl } from "@sheperd/protocol";
import { useConnection, useHostState } from "../lib/connection";
import { usePalette } from "../theme";

const MONO = Platform.select({ android: "monospace", default: "Menlo" });
const NTFY_PLAY_STORE = "https://play.google.com/store/apps/details?id=io.heckel.ntfy";

async function subscribeToNotifications(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert("Install ntfy", "sheperd sends notifications through the free ntfy app. Install it, then tap this again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Open Play Store", onPress: () => void Linking.openURL(NTFY_PLAY_STORE) },
    ]);
  }
}

export default function ConnectScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { settings, connect, forget } = useConnection();
  const state = useHostState();
  const [manual, setManual] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");

  const saveManual = async () => {
    let normalised: string;
    try {
      normalised = normaliseHostUrl(url);
    } catch (err) {
      Alert.alert("Invalid address", (err as Error).message);
      return;
    }
    if (!token.trim()) {
      Alert.alert("Missing token", "Paste the token printed by sheperd-host.");
      return;
    }
    await connect({ urls: [normalised], token: token.trim() });
    router.dismissTo("/");
  };

  const input = [styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];
  const card = [styles.card, { backgroundColor: palette.surface, borderColor: palette.border }];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {settings ? (
          <View style={card}>
            <Text style={[styles.title, { color: palette.text }]}>{state.host?.name ?? settings.name ?? "Host"}</Text>
            <Text style={{ color: palette.muted }}>
              {state.status === "online" ? `Connected · herdr ${state.host?.herdrVersion ?? ""}` : statusText(state.status)}
            </Text>
            {settings.urls.map((u) => (
              <Text key={u} style={[styles.url, { color: u === state.activeUrl ? palette.accent : palette.muted }]} numberOfLines={1}>
                {u === state.activeUrl ? "● " : "○ "}
                {u}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={[styles.help, { color: palette.muted }]}>
            On your computer, run <Text style={{ fontFamily: MONO, color: palette.text }}>npm start -w host</Text> and scan the QR code
            it prints.
          </Text>
        )}

        {settings && state.status === "online" ? (
          <View style={card}>
            <Text style={[styles.label, { color: palette.text, marginTop: 0 }]}>Notifications</Text>
            {state.host?.notifyUrl ? (
              <>
                <Text style={{ color: palette.muted }}>
                  Get a notification when an agent needs input or finishes, even when this app is closed.
                </Text>
                <Pressable
                  style={[styles.button, styles.outline, { borderColor: palette.accent, marginTop: 8 }]}
                  onPress={() => void subscribeToNotifications(state.host!.notifyUrl!)}
                >
                  <Text style={[styles.buttonText, { color: palette.accent }]}>Get notifications (ntfy)</Text>
                </Pressable>
              </>
            ) : (
              <Text style={{ color: palette.muted }}>
                Off. To turn them on, run <Text style={{ fontFamily: MONO, color: palette.text }}>npm start -w host -- notify on</Text> on
                your computer and restart the host.
              </Text>
            )}
          </View>
        ) : null}

        <Link href="/scan" asChild>
          <Pressable style={[styles.button, { backgroundColor: palette.accent }]}>
            <Text style={styles.buttonText}>{settings ? "Scan a new QR code" : "Scan QR code"}</Text>
          </Pressable>
        </Link>

        {manual ? (
          <View style={{ gap: 8 }}>
            <Text style={[styles.label, { color: palette.text }]}>Host address</Text>
            <TextInput
              style={input}
              value={url}
              onChangeText={setUrl}
              placeholder="192.168.1.20 or wss://relay…/connect"
              placeholderTextColor={palette.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={[styles.label, { color: palette.text }]}>Token</Text>
            <TextInput
              style={input}
              value={token}
              onChangeText={setToken}
              placeholder="Token from sheperd-host"
              placeholderTextColor={palette.muted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <Pressable style={[styles.button, styles.outline, { borderColor: palette.accent }]} onPress={saveManual}>
              <Text style={[styles.buttonText, { color: palette.accent }]}>Connect</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.link} onPress={() => setManual(true)}>
            <Text style={{ color: palette.accent }}>Enter address and token manually</Text>
          </Pressable>
        )}

        {settings ? (
          <Pressable
            style={styles.link}
            onPress={() =>
              Alert.alert("Forget this host?", "You'll need to scan its QR code again.", [
                { text: "Cancel", style: "cancel" },
                { text: "Forget", style: "destructive", onPress: () => void forget() },
              ])
            }
          >
            <Text style={{ color: palette.danger }}>Forget this host</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function statusText(status: string): string {
  switch (status) {
    case "connecting":
      return "Connecting…";
    case "unauthorized":
      return "Token rejected. Scan the QR code again.";
    case "offline":
      return "Can't reach the host. Retrying…";
    default:
      return "Not connected";
  }
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  help: { fontSize: 15, lineHeight: 22 },
  card: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 4 },
  title: { fontSize: 18, fontWeight: "600" },
  url: { fontFamily: MONO, fontSize: 12 },
  label: { fontSize: 14, fontWeight: "600", marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  button: { borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  outline: { borderWidth: 1.5, backgroundColor: "transparent" },
  buttonText: { color: "#FFFFFF", fontWeight: "600", fontSize: 16 },
  link: { alignItems: "center", paddingVertical: 10 },
});
