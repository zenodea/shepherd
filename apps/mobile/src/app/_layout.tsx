import "../connection/crypto-polyfill";
import { useFonts } from "expo-font";
import { Stack, usePathname, useRouter } from "expo-router";
import { Fragment, useEffect, useRef } from "react";
import { StatusBar } from "expo-status-bar";
import { ConnectionProvider, useConnection } from "../connection/connection";
import { AppLockProvider } from "../security/app-lock";
import { ThemeProvider, useTheme } from "../ui/ThemeProvider";
import { colors } from "../ui/theme";

/**
 * Opening the app lands on the agent list whenever a computer is paired, even
 * if it was last showing pairing screens (dev reloads restore the last route).
 * Deep links to an agent or a pairing code are left alone.
 */
function StartOnAgents() {
  const { settings } = useConnection();
  const pathname = usePathname();
  const router = useRouter();
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current || settings === undefined) return;
    decided.current = true;
    if (settings && (pathname === "/connect" || pathname === "/scan")) router.replace("/");
  }, [settings, pathname, router]);
  return null;
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <App />
    </ThemeProvider>
  );
}

function App() {
  const { dark, version } = useTheme();
  // Monospace for terminals; the app renders with a system fallback until loaded.
  useFonts({
    JetBrainsMono: require("../../assets/fonts/JetBrainsMono-Regular.ttf"),
    "JetBrainsMono-Bold": require("../../assets/fonts/JetBrainsMono-Bold.ttf"),
  });
  return (
    <AppLockProvider>
      <ConnectionProvider>
        <StatusBar style={dark ? "light" : "dark"} />
        <StartOnAgents />
        <Stack
          // Redraw every screen (keeping the navigation stack) when the theme changes.
          screenLayout={({ children }) => <Fragment key={version}>{children}</Fragment>}
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: "slide_from_right",
          }}
        >
          <Stack.Screen name="scan" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
        </Stack>
      </ConnectionProvider>
    </AppLockProvider>
  );
}
