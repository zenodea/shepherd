import "../connection/crypto-polyfill";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ConnectionProvider } from "../connection/connection";
import { usePalette } from "../ui/theme";

export default function RootLayout() {
  const palette = usePalette();
  return (
    <ConnectionProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.surface },
          headerTintColor: palette.text,
          contentStyle: { backgroundColor: palette.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Agents" }} />
        <Stack.Screen name="connect" options={{ title: "Host" }} />
        <Stack.Screen name="agent/[paneId]" options={{ title: "Agent" }} />
        <Stack.Screen name="new" options={{ title: "New agent" }} />
        <Stack.Screen name="scan" options={{ title: "Scan QR code", presentation: "modal" }} />
        <Stack.Screen name="pair" options={{ title: "Pairing" }} />
      </Stack>
    </ConnectionProvider>
  );
}
