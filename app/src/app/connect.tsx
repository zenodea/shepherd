import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useConnection } from "../lib/connection";
import { normaliseUrl } from "../lib/settings-store";
import { usePalette } from "../theme";

export default function ConnectScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { settings, connect, forget } = useConnection();
  const [url, setUrl] = useState(settings?.url ?? "");
  const [token, setToken] = useState(settings?.token ?? "");

  const save = async () => {
    let normalised: string;
    try {
      normalised = normaliseUrl(url);
    } catch (err) {
      Alert.alert("Invalid address", (err as Error).message);
      return;
    }
    if (!token.trim()) {
      Alert.alert("Missing token", "Paste the token printed by sheperd-host.");
      return;
    }
    await connect({ url: normalised, token: token.trim() });
    router.replace("/");
  };

  const input = [styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[styles.help, { color: palette.muted }]}>
          Run <Text style={styles.code}>npm start -w host</Text> on your computer. It prints a URL and a token to paste here.
        </Text>

        <Text style={[styles.label, { color: palette.text }]}>Host URL</Text>
        <TextInput
          style={input}
          value={url}
          onChangeText={setUrl}
          placeholder="ws://192.168.1.20:7420/connect"
          placeholderTextColor={palette.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={[styles.hint, { color: palette.muted }]}>
          Same Wi-Fi or Tailscale: the ws:// URL. Anywhere: the relay URL (wss://…/hosts/…/connect).
        </Text>

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

        <Pressable style={[styles.button, { backgroundColor: palette.accent }]} onPress={save}>
          <Text style={styles.buttonText}>Connect</Text>
        </Pressable>

        {settings ? (
          <Pressable
            style={styles.secondary}
            onPress={async () => {
              await forget();
              setUrl("");
              setToken("");
            }}
          >
            <Text style={{ color: palette.danger }}>Forget this host</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8 },
  help: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  code: { fontFamily: Platform.select({ android: "monospace", default: "Menlo" }) },
  label: { fontSize: 14, fontWeight: "600", marginTop: 8 },
  hint: { fontSize: 12, lineHeight: 16 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  button: { marginTop: 16, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontWeight: "600", fontSize: 16 },
  secondary: { alignItems: "center", paddingVertical: 12 },
});
