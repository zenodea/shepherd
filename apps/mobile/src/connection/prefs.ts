import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Small UI preferences. SecureStore is what's available everywhere in Expo Go;
// on web (demo previews) they just aren't persisted.
export async function loadPref(key: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    return await SecureStore.getItemAsync(`sheperd.pref.${key}`);
  } catch {
    return null;
  }
}

export async function savePref(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") return;
  await SecureStore.setItemAsync(`sheperd.pref.${key}`, value).catch(() => {});
}
