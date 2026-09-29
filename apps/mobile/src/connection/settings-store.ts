import * as SecureStore from "expo-secure-store";
import type { ConnectionSettings } from "./host-client";

const KEY = "sheperd.connection";

export async function loadSettings(): Promise<ConnectionSettings | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConnectionSettings> & { url?: string };
    // v0 stored a single `url`.
    const urls = parsed.urls ?? (parsed.url ? [parsed.url] : []);
    return urls.length > 0 && parsed.token ? { name: parsed.name, urls, token: parsed.token, hostKey: parsed.hostKey } : null;
  } catch {
    return null;
  }
}

export async function saveSettings(settings: ConnectionSettings): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(settings));
}

export async function clearSettings(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
