import { useRouter } from "expo-router";
import { ChevronLeft, Globe, Laptop, Network, QrCode, Smartphone, Trash2, Wifi } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { normaliseHostUrl } from "@shepherd/protocol";
import { addressHost, addressKind } from "../connection/addresses";
import { useConnection, useHostState } from "../connection/connection";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { ListGroup, ListRow } from "../ui/ListRow";
import { Divider, Screen } from "../ui/Screen";
import { colors, fonts, radii, space, statusColors, type, themed } from "../ui/theme";

export default function HostScreen() {
  const router = useRouter();
  const { settings } = useConnection();
  return (
    <Screen>
      {settings ? (
        <View style={styles.header}>
          <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
            <ChevronLeft size={22} color={colors.text} />
          </IconButton>
          <Text style={styles.headerTitle}>Host</Text>
        </View>
      ) : null}
      {/* undefined = still loading saved computers: don't flash the pairing page. */}
      {settings === undefined ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.muted} />
      ) : settings ? (
        <PairedHost />
      ) : (
        <PairOnboarding />
      )}
    </Screen>
  );
}

function IconCircle({ children }: { children: ReactNode }) {
  return <View style={styles.iconCircle}>{children}</View>;
}

function PairedHost() {
  const router = useRouter();
  const { settings, forget } = useConnection();
  const state = useHostState();
  const urls = state.urls.length > 0 ? state.urls : (settings?.urls ?? []);
  const online = state.status === "online";

  const status =
    state.status === "online" && state.activeUrl
      ? `Connected via ${addressKind(state.activeUrl)}`
      : state.status === "connecting"
        ? "Connecting…"
        : state.status === "unauthorized"
          ? "Not paired"
          : "Can't reach your computer";

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: space.xxl * 2, gap: space.lg }}>
      <View style={styles.hero}>
        <IconCircle>
          <Laptop size={26} color={colors.text} />
        </IconCircle>
        <Text style={type.title}>{state.host?.name ?? settings?.name ?? "Host"}</Text>
        <View style={styles.statusLine}>
          <View style={[styles.dot, { backgroundColor: online ? statusColors.done : state.status === "connecting" ? colors.subtle : colors.danger }]} />
          <Text style={type.sub}>
            {status}
            {online && state.host ? `  ·  herdr ${state.host.herdrVersion}` : ""}
          </Text>
        </View>
        {(state.status === "unauthorized" || state.status === "offline") && state.error ? (
          <Text style={[type.sub, styles.error]}>{state.error}</Text>
        ) : null}
      </View>

      <View>
        <Text style={styles.groupLabel}>Connection</Text>
        <ListGroup>
          {urls.map((url, i) => {
            const kind = addressKind(url);
            const active = url === state.activeUrl;
            return (
              <View key={url}>
                {i > 0 ? <Divider inset={56} /> : null}
                <ListRow
                  icon={
                    kind === "Relay" ? (
                      <Globe size={19} color={colors.muted} />
                    ) : kind === "Tailscale" ? (
                      <Network size={19} color={colors.muted} />
                    ) : (
                      <Wifi size={19} color={colors.muted} />
                    )
                  }
                  title={kind}
                  detail={addressHost(url)}
                  trailing={active ? <Text style={[type.caption, { color: statusColors.done }]}>In use</Text> : null}
                />
              </View>
            );
          })}
          {state.device ? (
            <>
              <Divider inset={56} />
              <ListRow icon={<Smartphone size={19} color={colors.muted} />} title="This phone" detail={`${state.device.name} · ${state.device.id}`} />
            </>
          ) : null}
        </ListGroup>
      </View>

      <ListGroup>
        <ListRow icon={<QrCode size={19} color={colors.muted} />} title="Pair again" detail="Scan a new QR code from your computer" onPress={() => router.push("/scan")} />
        <Divider inset={56} />
        <ListRow
          icon={<Trash2 size={19} color={colors.danger} />}
          title="Forget this computer"
          destructive
          chevron={false}
          onPress={() =>
            Alert.alert(
              "Forget this computer?",
              "You'll need to scan a new pairing QR code. To also remove this phone on the host, run `npm run host -- devices revoke <id>`.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Forget", style: "destructive", onPress: () => void forget().then(() => router.dismissTo("/")) },
              ],
            )
          }
        />
      </ListGroup>
    </ScrollView>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{n}</Text>
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={type.row}>{title}</Text>
        {children}
      </View>
    </View>
  );
}

function PairOnboarding() {
  const router = useRouter();
  const { connect } = useConnection();
  const [manual, setManual] = useState(false);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");

  const saveManual = async () => {
    let normalised: string;
    try {
      normalised = normaliseHostUrl(url);
    } catch (err) {
      Alert.alert("Invalid address", (err as Error).message);
      return;
    }
    if (!code.trim()) {
      Alert.alert("Missing pairing code", "Run `npm run host -- pair` and paste the code it prints.");
      return;
    }
    await connect({ urls: [normalised], token: code.trim() });
    router.dismissTo("/");
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.onboarding} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <IconCircle>
            <Laptop size={26} color={colors.text} />
          </IconCircle>
          <Text style={styles.onboardingTitle}>Pair with your computer</Text>
          <Text style={[type.body, { color: colors.muted, textAlign: "center" }]}>Watch and steer your herdr agents from here.</Text>
        </View>

        <View style={styles.steps}>
          <Step n={1} title="On your computer, start the host">
            <Text style={styles.command}>npm run host</Text>
          </Step>
          <Step n={2} title="Scan the QR code it prints" />
          <Step n={3} title="Your agents show up here" />
        </View>

        <View style={{ gap: space.sm }}>
          <Button title="Scan QR code" icon={<QrCode size={18} color={colors.onPrimary} />} onPress={() => router.push("/scan")} />
          {!manual ? <Button title="Enter a code instead" variant="ghost" onPress={() => setManual(true)} /> : null}
        </View>

        {manual ? (
          <View style={{ gap: space.sm }}>
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              placeholder="Address, e.g. 192.168.1.20"
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              placeholder="Pairing code (p_…)"
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={type.caption}>The code is on the `Code:` line printed by `npm run host -- pair`.</Text>
            <Button title="Pair" variant="secondary" onPress={saveManual} />
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = themed(() => StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  headerTitle: { fontSize: 17, fontWeight: "600", color: colors.text },
  hero: { alignItems: "center", gap: 8, paddingHorizontal: space.xl, paddingTop: space.lg },
  iconCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  error: { color: colors.danger, textAlign: "center" },
  groupLabel: { ...type.sub, paddingHorizontal: space.lg + 4, paddingBottom: 8 },
  onboarding: { padding: space.xl, paddingTop: space.xxl * 2, gap: space.xxl },
  onboardingTitle: { fontSize: 24, fontWeight: "600", color: colors.text, textAlign: "center" },
  steps: { gap: space.lg },
  step: { flexDirection: "row", gap: space.md },
  stepNumber: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
  stepNumberText: { fontSize: 13, fontWeight: "600", color: colors.text },
  command: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: "flex-start",
    overflow: "hidden",
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
}));
