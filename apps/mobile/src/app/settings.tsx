import { useRouter } from "expo-router";
import { BatteryCharging, Bell, BellOff, BellRing, Check, Fingerprint, Image as ImageIcon, Laptop, LockOpen, QrCode } from "lucide-react-native";
import { setImagesShown, useImagesShown } from "../agents/image-setting";
import { setAnswerUnlocked, useAnswerUnlocked } from "../notifications/lock-screen-setting";
import { useEffect, useState } from "react";
import { Alert, AppState, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import Background from "../../modules/shepherd-background/src/ShepherdBackgroundModule";
import { NOTIFICATIONS_SUPPORTED, setNotificationsEnabled, useNotificationsEnabled } from "../notifications/setting";
import { useConnection } from "../connection/connection";
import { PressableScale } from "../ui/Pressable";
import { useTheme } from "../ui/ThemeProvider";
import { RELOCK_AFTER_MS, useAppLock } from "../security/app-lock";
import { ListGroup, ListRow } from "../ui/ListRow";
import { Divider, Screen, ScreenHeader } from "../ui/Screen";
import { Select } from "../ui/Select";
import { Toggle } from "../ui/Toggle";
import { THEMES, colors, radii, space, type, themed, type Palette, type ThemeMode } from "../ui/theme";

export default function SettingsScreen() {
  const router = useRouter();
  const lock = useAppLock();
  const { hosts, settings, switchTo } = useConnection();
  const [busy, setBusy] = useState(false);
  const theme = useTheme();
  const notifications = useNotificationsEnabled();
  const imagesShown = useImagesShown();
  const answerUnlocked = useAnswerUnlocked();
  // What Android allows, re-checked when you come back from its settings.
  const [system, setSystem] = useState({ allowed: true, unrestricted: true });
  useEffect(() => {
    if (!Background) return;
    const native = Background;
    const check = () => setSystem({ allowed: native.notificationsEnabled(), unrestricted: native.isIgnoringBatteryOptimizations() });
    check();
    const sub = AppState.addEventListener("change", (s) => s === "active" && check());
    return () => sub.remove();
  }, []);

  /** Shows one right away, the way agents' notifications are shown, or says why it can't. */
  const testNotification = async () => {
    try {
      const result = await Background!.notify({ id: 1, channel: "finished", title: "Shepherd test", body: "Notifications work. Agents' ones show up like this when Shepherd isn't open.", url: "shepherd://settings", paneId: "", answers: [], timeoutMs: 15_000 });
      // What Android made of it, so a notification that doesn't appear can be explained.
      Alert.alert("Test notification", result);
    } catch (err) {
      Alert.alert("Couldn't show a notification", (err as Error).message);
    }
  };

  const toggleNotifications = async (on: boolean) => {
    if (!(await setNotificationsEnabled(on)) && on) {
      Alert.alert("Notifications are blocked", "Allow notifications for Shepherd in Android's settings, then turn this on again.", [
        { text: "Not now", style: "cancel" },
        { text: "Open settings", onPress: () => void Linking.openSettings() },
      ]);
    }
  };

  const toggleLock = async (on: boolean) => {
    setBusy(true);
    try {
      await lock.setEnabled(on);
    } catch (err) {
      Alert.alert("Can't turn on app lock", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xxl * 2, gap: space.lg, paddingTop: space.sm }}>
        <View>
          <Text style={styles.groupLabel}>Computers</Text>
          <ListGroup>
            {hosts.map((host) => {
              const active = host.id === settings?.id;
              return (
                <View key={host.id}>
                  <ListRow
                    icon={<Laptop size={19} color={colors.muted} />}
                    title={host.name ?? "Computer"}
                    detail={active ? "In use · tap for details" : "Tap to switch"}
                    chevron={active}
                    trailing={active ? <Check size={18} color={colors.text} /> : null}
                    onPress={() => (active ? router.push("/connect") : void switchTo(host.id).then(() => router.dismissTo("/")))}
                  />
                  <Divider inset={56} />
                </View>
              );
            })}
            <ListRow
              icon={<QrCode size={19} color={colors.muted} />}
              title="Add a computer"
              detail="Scan the QR code in the Shepherd window on your computer"
              onPress={() => router.push("/scan")}
            />
          </ListGroup>
        </View>

        <View>
          <Text style={styles.groupLabel}>Appearance</Text>
          <View style={styles.modes} accessibilityRole="radiogroup">
            {MODES.map((m) => {
              const active = theme.mode === m.id;
              return (
                <PressableScale
                  key={m.id}
                  onPress={() => theme.setMode(m.id)}
                  style={[styles.mode, active && styles.modeActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                >
                  <Text style={[styles.modeText, active && styles.modeTextActive]}>{m.label}</Text>
                </PressableScale>
              );
            })}
          </View>
          <ListGroup>
            <Select
              title="Theme"
              value={theme.theme}
              onChange={theme.setTheme}
              options={THEMES.map((t) => ({ value: t.id, label: t.name, icon: <Swatch palette={theme.dark ? t.dark : t.light} /> }))}
            />
          </ListGroup>
        </View>

        {NOTIFICATIONS_SUPPORTED ? (
          <View>
            <Text style={styles.groupLabel}>Notifications</Text>
            <ListGroup>
              <ListRow
                icon={<Bell size={19} color={colors.muted} />}
                title="Notifications"
                detail="When an agent needs input or finishes. Shepherd stays connected to your computer in the background."
                chevron={false}
                trailing={<Toggle value={notifications === true} onValueChange={(on) => void toggleNotifications(on)} disabled={notifications === null} />}
              />
              {notifications && !system.allowed ? (
                <>
                  <Divider inset={56} />
                  <ListRow
                    icon={<BellOff size={19} color={colors.danger} />}
                    title="Blocked in Android settings"
                    detail="Tap to allow notifications for Shepherd"
                    onPress={() => void Linking.openSettings()}
                  />
                </>
              ) : null}
              {notifications && !system.unrestricted ? (
                <>
                  <Divider inset={56} />
                  <ListRow
                    icon={<BatteryCharging size={19} color={colors.muted} />}
                    title="Run in the background without limits"
                    detail="Otherwise Android can delay notifications while your phone is idle"
                    onPress={() => void Background?.requestIgnoreBatteryOptimizations().catch(() => {})}
                  />
                </>
              ) : null}
              {notifications ? (
                <>
                  <Divider inset={56} />
                  <ListRow
                    icon={<LockOpen size={19} color={colors.muted} />}
                    title="Answer without unlocking"
                    detail="Off: answering from the lock screen asks for your fingerprint or screen lock first, so someone holding your phone can't approve anything."
                    chevron={false}
                    trailing={<Toggle value={answerUnlocked} onValueChange={setAnswerUnlocked} />}
                  />
                  <Divider inset={56} />
                  <ListRow icon={<BellRing size={19} color={colors.muted} />} title="Send a test notification" chevron={false} onPress={() => void testNotification()} />
                </>
              ) : null}
            </ListGroup>
          </View>
        ) : null}

        <View>
          <Text style={styles.groupLabel}>Conversations</Text>
          <ListGroup>
            <ListRow
              icon={<ImageIcon size={19} color={colors.muted} />}
              title="Show images"
              detail="Load the images agents read, like screenshots, as they appear. Off, tap one to load it."
              chevron={false}
              trailing={<Toggle value={imagesShown} onValueChange={setImagesShown} />}
            />
          </ListGroup>
        </View>

        <View>
          <Text style={styles.groupLabel}>Security</Text>
          <ListGroup>
            <ListRow
              icon={<Fingerprint size={19} color={colors.muted} />}
              title="App lock"
              detail={`Fingerprint or screen lock to open Shepherd, and after ${RELOCK_AFTER_MS / 60_000} min away`}
              chevron={false}
              trailing={<Toggle value={lock.enabled === true} onValueChange={(on) => void toggleLock(on)} disabled={busy || lock.enabled === undefined} />}
            />
          </ListGroup>
        </View>
      </ScrollView>
    </Screen>
  );
}

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "System" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];

const SWATCH_DOT = 7;
const SWATCH_GAP = 3;

/** A theme at a glance: its background with the text, accent and status colours on it. */
function Swatch({ palette }: { palette: Palette }) {
  const dots = [palette.text, palette.brand, palette.status.working, palette.status.done];
  return (
    <View style={[styles.swatch, { backgroundColor: palette.background, borderColor: palette.border }]}>
      <View style={styles.swatchGrid}>
        {dots.map((c, i) => (
          <View key={i} style={[styles.swatchDot, { backgroundColor: c }]} />
        ))}
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  groupLabel: { ...type.sub, paddingHorizontal: space.lg + 4, paddingBottom: 8 },
  modes: { flexDirection: "row", marginHorizontal: space.lg, marginBottom: space.sm, padding: 3, gap: 3, borderRadius: radii.md, backgroundColor: colors.surface },
  mode: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: radii.sm },
  modeActive: { backgroundColor: colors.raised },
  modeText: { fontSize: 14, fontWeight: "500", color: colors.muted },
  modeTextActive: { color: colors.text },
  swatch: { width: 28, height: 28, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  // Exactly two dots wide, so the 2×2 grid sits in the middle of the tile.
  swatchGrid: { width: SWATCH_DOT * 2 + SWATCH_GAP, flexDirection: "row", flexWrap: "wrap", gap: SWATCH_GAP },
  swatchDot: { width: SWATCH_DOT, height: SWATCH_DOT, borderRadius: SWATCH_DOT / 2 },
}));
