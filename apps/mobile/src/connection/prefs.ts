import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Small UI preferences. SecureStore is what's available everywhere in Expo Go;
// on web (demo previews) they live in the browser's localStorage.
export async function loadPref(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return globalThis.localStorage?.getItem(`shepherd.pref.${key}`) ?? null;
    } catch {
      return null;
    }
  }
  try {
    // Falls back to the key from before the rename (it was misspelled "sheperd").
    return (await SecureStore.getItemAsync(`shepherd.pref.${key}`)) ?? (await SecureStore.getItemAsync(`sheperd.pref.${key}`));
  } catch {
    return null;
  }
}

export async function savePref(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.setItem(`shepherd.pref.${key}`, value);
    } catch {
      // private mode: not persisted
    }
    return;
  }
  await SecureStore.setItemAsync(`shepherd.pref.${key}`, value).catch(() => {});
}
