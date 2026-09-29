import * as LocalAuthentication from "expo-local-authentication";
import { Lock } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform, StyleSheet, Text, View } from "react-native";
import { loadPref, savePref } from "../connection/prefs";
import { Button } from "../ui/Button";
import { colors, space, type, themed } from "../ui/theme";

/** Coming back within this long doesn't ask again (e.g. a quick look at another app). */
export const RELOCK_AFTER_MS = 60_000;

type AppLockValue = {
  /** undefined while the saved preference loads */
  enabled: boolean | undefined;
  /** Turning it on or off asks for the fingerprint (or screen lock) first. */
  setEnabled: (on: boolean) => Promise<boolean>;
};

const AppLockContext = createContext<AppLockValue | null>(null);

/** Why the lock can't be used on this phone, or null if it can. */
export async function lockUnavailableReason(): Promise<string | null> {
  if (Platform.OS === "web") return "App lock isn't available here.";
  if (!(await LocalAuthentication.hasHardwareAsync())) return "This phone has no fingerprint or face unlock.";
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) return "Set up a screen lock on this phone first.";
  return null;
}

function authenticate(promptMessage: string): Promise<boolean> {
  return LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: "Cancel" }).then(
    (r) => r.success,
    () => false,
  );
}

/**
 * Asks for the phone's fingerprint, face or screen lock when shepherd opens,
 * and again after it's been in the background for a minute. shepherd can type
 * into your computer, so this keeps someone holding your unlocked phone out.
 */
export function AppLockProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean | undefined>(undefined);
  const [locked, setLocked] = useState(true);
  const backgroundedAt = useRef<number | null>(null);
  const prompting = useRef(false);

  useEffect(() => {
    void loadPref("appLock").then((v) => setEnabledState(v === "on"));
  }, []);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      if (await authenticate("Unlock Shepherd")) setLocked(false);
    } finally {
      prompting.current = false;
    }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      // The fingerprint prompt itself briefly backgrounds the app on Android.
      if (prompting.current) return;
      if (state === "background") backgroundedAt.current = Date.now();
      if (state === "active" && backgroundedAt.current !== null) {
        if (Date.now() - backgroundedAt.current >= RELOCK_AFTER_MS) setLocked(true);
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, []);

  const showLock = enabled === true && locked;
  useEffect(() => {
    if (showLock) void unlock();
  }, [showLock, unlock]);

  const setEnabled = useCallback(async (on: boolean) => {
    if (on) {
      const reason = await lockUnavailableReason();
      if (reason) throw new Error(reason);
    }
    prompting.current = true;
    try {
      if (!(await authenticate(on ? "Turn on app lock" : "Turn off app lock"))) return false;
    } finally {
      prompting.current = false;
    }
    await savePref("appLock", on ? "on" : "off");
    setLocked(false);
    setEnabledState(on);
    return true;
  }, []);

  const value = useMemo(() => ({ enabled, setEnabled }), [enabled, setEnabled]);
  return (
    <AppLockContext.Provider value={value}>
      {children}
      {/* Covers the app (and whatever it was showing) until unlocked; also hides it while the pref loads. */}
      {enabled === undefined || showLock ? (
        <View style={styles.cover}>
          {showLock ? (
            <>
              <View style={styles.icon}>
                <Lock size={26} color={colors.text} />
              </View>
              <Text style={type.title}>Shepherd is locked</Text>
              <Button title="Unlock" onPress={() => void unlock()} style={{ alignSelf: "stretch", marginTop: space.lg }} />
            </>
          ) : null}
        </View>
      ) : null}
    </AppLockContext.Provider>
  );
}

export function useAppLock(): AppLockValue {
  const value = useContext(AppLockContext);
  if (!value) throw new Error("useAppLock must be used inside AppLockProvider");
  return value;
}

const styles = themed(() => StyleSheet.create({
  cover: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    padding: space.xxl,
  },
  icon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center", marginBottom: 4 },
}));
