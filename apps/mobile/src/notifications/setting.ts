import { useSyncExternalStore } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import Background from "../../modules/shepherd-background/src/ShepherdBackgroundModule";
import { loadPref, savePref } from "../connection/prefs";

const PREF = "notifications";

/** Background notifications need the native module, so Android builds of the app only. */
export const NOTIFICATIONS_SUPPORTED = Platform.OS === "android" && Background !== null;

let enabled: boolean | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

void loadPref(PREF).then((v) => {
  enabled = v === "on";
  emit();
});

/** Whether notifications are on: null until the saved setting has loaded. */
export function useNotificationsEnabled(): boolean | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => enabled,
  );
}

/** Turn notifications on (asking Android for permission) or off. Resolves to whether they're on. */
export async function setNotificationsEnabled(on: boolean): Promise<boolean> {
  if (on && Platform.OS === "android" && Number(Platform.Version) >= 33) {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) return false;
  }
  enabled = on;
  emit();
  await savePref(PREF, on ? "on" : "off");
  return on;
}
