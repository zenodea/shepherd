import "../connection/crypto-polyfill";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ConnectionProvider } from "../connection/connection";
import { colors } from "../ui/theme";

export default function RootLayout() {
  return (
    <ConnectionProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="scan" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      </Stack>
    </ConnectionProvider>
  );
}
