import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRef, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { parsePairingLink } from "@sheperd/protocol";
import { usePairing } from "../connection/use-pairing";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { colors, type } from "../ui/theme";

export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const closeButton = (
    <IconButton label="Close" onPress={close} style={[styles.close, { top: insets.top + 8 }]}>
      <X size={20} color={colors.text} />
    </IconButton>
  );
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState<string | null>(null);
  const handled = useRef(false);
  const pair = usePairing();

  if (!permission) return <View style={styles.fill} />;

  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text style={[type.title, { textAlign: "center" }]}>Camera access</Text>
        <Text style={[type.body, { color: colors.muted, textAlign: "center" }]}>
          sheperd uses the camera to scan the QR code printed by <Text style={styles.mono}>npm run host</Text>.
        </Text>
        <Button
          title={permission.canAskAgain ? "Allow camera" : "Open settings"}
          onPress={permission.canAskAgain ? requestPermission : () => void Linking.openSettings()}
          style={{ alignSelf: "stretch", marginTop: 8 }}
        />
        {closeButton}
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          const info = parsePairingLink(data);
          if (!info) {
            setMessage("That isn't a sheperd pairing code.");
            return;
          }
          handled.current = true;
          void pair(info);
        }}
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.frame} />
        <Text style={styles.overlayText}>{message ?? "Point at the QR code from sheperd-host"}</Text>
      </View>
      {closeButton}
    </View>
  );
}

const styles = StyleSheet.create({
  close: { position: "absolute", left: 16, backgroundColor: "rgba(28,28,28,0.85)" },
  fill: { flex: 1, backgroundColor: "#000" },
  center: { alignItems: "center", justifyContent: "center", padding: 32, gap: 12, backgroundColor: colors.background },
  mono: { fontFamily: "monospace", color: colors.text },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 24 },
  frame: { width: 250, height: 250, borderWidth: 2, borderColor: "rgba(255,255,255,0.85)", borderRadius: 28 },
  overlayText: {
    color: "#FFFFFF",
    fontSize: 15,
    backgroundColor: "rgba(10,10,10,0.8)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
});
