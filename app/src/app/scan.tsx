import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { parsePairingLink } from "@sheperd/protocol";
import { usePairing } from "../lib/use-pairing";
import { usePalette } from "../theme";

export default function ScanScreen() {
  const palette = usePalette();
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState<string | null>(null);
  const handled = useRef(false);
  const pair = usePairing();

  if (!permission) return <View style={styles.fill} />;

  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text style={[styles.text, { color: palette.text }]}>
          sheperd needs the camera to scan the QR code printed by <Text style={styles.mono}>npm start -w host</Text>.
        </Text>
        <Pressable
          style={[styles.button, { backgroundColor: palette.accent }]}
          onPress={permission.canAskAgain ? requestPermission : () => void Linking.openSettings()}
        >
          <Text style={styles.buttonText}>{permission.canAskAgain ? "Allow camera" : "Open settings to allow camera"}</Text>
        </Pressable>
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
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#000" },
  center: { alignItems: "center", justifyContent: "center", padding: 24, gap: 16, backgroundColor: "transparent" },
  text: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  mono: { fontFamily: "monospace" },
  button: { borderRadius: 8, paddingHorizontal: 20, paddingVertical: 12 },
  buttonText: { color: "#FFFFFF", fontWeight: "600" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 24 },
  frame: { width: 260, height: 260, borderWidth: 3, borderColor: "#FFFFFFCC", borderRadius: 16 },
  overlayText: {
    color: "#FFFFFF",
    fontSize: 15,
    backgroundColor: "#000000AA",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
});
