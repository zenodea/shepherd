import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ConnectionProvider } from "../lib/connection";
import { usePalette } from "../theme";

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
        <Stack.Screen name="connect" options={{ title: "Connect to host" }} />
        <Stack.Screen name="agent/[paneId]" options={{ title: "Agent" }} />
      </Stack>
    </ConnectionProvider>
  );
}
