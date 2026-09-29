import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import type { ConnectionSettings } from "./host-client";

/** A paired computer. */
export type SavedHost = ConnectionSettings & { id: string };

export type HostList = { hosts: SavedHost[]; activeId: string | null };

// Each host is stored under its own key (SecureStore values should stay
// small); the index holds the order and which one is in use.
const INDEX_KEY = "sheperd.hosts";
const hostKey = (id: string) => `sheperd.host.${id}`;
/** v1 stored a single host here. */
const LEGACY_KEY = "sheperd.connection";

/**
 * A host's id: derived from its identity key, so pairing the same computer
 * again replaces it instead of adding a duplicate. It also appears in
 * notification links (`?host=`) so they open on the right computer.
 */
export function hostIdFor(settings: ConnectionSettings): string {
  return settings.hostKey ? settings.hostKey.slice(0, 16) : Crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function parseSettings(raw: string | null): ConnectionSettings | null {
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

async function saveIndex(list: HostList): Promise<void> {
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify({ ids: list.hosts.map((h) => h.id), activeId: list.activeId }));
}

export async function loadHosts(): Promise<HostList> {
  const index = await SecureStore.getItemAsync(INDEX_KEY);
  if (!index) {
    const legacy = parseSettings(await SecureStore.getItemAsync(LEGACY_KEY));
    if (!legacy) return { hosts: [], activeId: null };
    const host = { ...legacy, id: hostIdFor(legacy) };
    const list = { hosts: [host], activeId: host.id };
    await saveHost(host);
    await saveIndex(list);
    await SecureStore.deleteItemAsync(LEGACY_KEY);
    return list;
  }
  let parsed: { ids?: string[]; activeId?: string | null };
  try {
    parsed = JSON.parse(index);
  } catch {
    return { hosts: [], activeId: null };
  }
  const hosts: SavedHost[] = [];
  for (const id of parsed.ids ?? []) {
    const settings = parseSettings(await SecureStore.getItemAsync(hostKey(id)));
    if (settings) hosts.push({ ...settings, id });
  }
  const activeId = hosts.some((h) => h.id === parsed.activeId) ? parsed.activeId! : (hosts[0]?.id ?? null);
  return { hosts, activeId };
}

export async function saveHost(host: SavedHost): Promise<void> {
  const { id, ...settings } = host;
  await SecureStore.setItemAsync(hostKey(id), JSON.stringify(settings));
}

export async function saveHostList(list: HostList): Promise<void> {
  await Promise.all(list.hosts.map(saveHost));
  await saveIndex(list);
}

export async function deleteHost(id: string, rest: HostList): Promise<void> {
  await SecureStore.deleteItemAsync(hostKey(id));
  await saveIndex(rest);
}
