import "../connection/crypto-polyfill";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ConnectionProvider } from "../connection/connection";
import { colors } from "../ui/theme";

export default function RootLayout() {
  // Monospace for terminals; the app renders with a system fallback until loaded.
  useFonts({
    JetBrainsMono: require("../../assets/fonts/JetBrainsMono-Regular.ttf"),
    "JetBrainsMono-Bold": require("../../assets/fonts/JetBrainsMono-Bold.ttf"),
  });
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
