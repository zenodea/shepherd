import { useRouter } from "expo-router";
import { Check, ChevronLeft, Fingerprint, Laptop, QrCode } from "lucide-react-native";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useConnection } from "../connection/connection";
import { RELOCK_AFTER_MS, useAppLock } from "../security/app-lock";
import { IconButton } from "../ui/IconButton";
import { ListGroup, ListRow } from "../ui/ListRow";
import { Divider, Screen } from "../ui/Screen";
import { Toggle } from "../ui/Toggle";
import { colors, space, type } from "../ui/theme";

export default function SettingsScreen() {
  const router = useRouter();
  const lock = useAppLock();
  const { hosts, settings, switchTo } = useConnection();
  const [busy, setBusy] = useState(false);

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
      <View style={styles.header}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
          <ChevronLeft size={22} color={colors.text} />
        </IconButton>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>
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
              detail="Scan the QR code from npm run host"
              onPress={() => router.push("/scan")}
            />
          </ListGroup>
        </View>

        <View>
          <Text style={styles.groupLabel}>Security</Text>
          <ListGroup>
            <ListRow
              icon={<Fingerprint size={19} color={colors.muted} />}
              title="App lock"
              detail={`Fingerprint or screen lock to open sheperd, and after ${RELOCK_AFTER_MS / 60_000} min away`}
              chevron={false}
              trailing={<Toggle value={lock.enabled === true} onValueChange={(on) => void toggleLock(on)} disabled={busy || lock.enabled === undefined} />}
            />
          </ListGroup>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  headerTitle: { fontSize: 17, fontWeight: "600", color: colors.text },
  groupLabel: { ...type.sub, paddingHorizontal: space.lg + 4, paddingBottom: 8 },
});
