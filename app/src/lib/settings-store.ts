import * as SecureStore from "expo-secure-store";
import type { ConnectionSettings } from "./host-client";

const KEY = "sheperd.connection";

export async function loadSettings(): Promise<ConnectionSettings | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ConnectionSettings;
    return parsed.url && parsed.token ? parsed : null;
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

/** Accepts `192.168.1.5`, `host:7420`, `ws://…/connect`, `https://relay/…` and normalises to a ws(s) URL. */
export function normaliseUrl(input: string): string {
  let url = input.trim();
  if (!/^[a-z]+:\/\//i.test(url)) url = `ws://${url}`;
  const parsed = new URL(url);
  if (parsed.protocol === "https:") parsed.protocol = "wss:";
  if (parsed.protocol === "http:") parsed.protocol = "ws:";
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") throw new Error("Use a ws://, wss://, http:// or https:// address");
  if (parsed.protocol === "ws:" && !parsed.port) parsed.port = "7420";
  if (parsed.pathname === "/" || parsed.pathname === "") parsed.pathname = "/connect";
  return parsed.toString();
}
