import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { DEMO_ENABLED, DEMO_MODE, DEMO_SETTINGS, DemoHost } from "./demo-host";
import { HostClient, type ConnectionSettings, type HostConnection, type HostState } from "./host-client";
import { deleteHost, hostIdFor, loadHosts, saveHost, saveHostList, type HostList, type SavedHost } from "./settings-store";

type ConnectionContextValue = {
  /** The computer in use; undefined while loading saved settings, null when none is paired. */
  settings: SavedHost | null | undefined;
  /** Every paired computer. */
  hosts: SavedHost[];
  client: HostConnection | null;
  /** Save a pairing (replacing the same computer if it was paired before) and switch to it. */
  connect: (settings: ConnectionSettings) => Promise<void>;
  switchTo: (id: string) => Promise<void>;
  /** Remove a computer (default: the one in use), switching to another if there is one. */
  forget: (id?: string) => Promise<void>;
};

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

const IDLE: HostState = { status: "idle", error: null, host: null, activeUrl: null, urls: [], device: null, agents: [] };

/** e.g. "Google Pixel 8"; shown in `npm run host -- devices`. */
function deviceName(): string {
  const c = Platform.constants as { Manufacturer?: string; Model?: string; Brand?: string };
  const maker = c.Manufacturer ?? c.Brand ?? "";
  const model = c.Model ?? "";
  const name = model.toLowerCase().startsWith(maker.toLowerCase()) ? model : `${maker} ${model}`;
  return name.trim() || (Platform.OS === "ios" ? "iPhone" : "Android phone");
}
const noopSubscribe = () => () => {};

const DEMO_HOST: SavedHost = { ...DEMO_SETTINGS, id: "demo" };

export function ConnectionProvider({ children }: { children: ReactNode }) {
  // `settings` changes only when you pair, switch or forget, which reconnects;
  // `hosts` also takes token and address updates from the host, which don't.
  const [settings, setSettings] = useState<SavedHost | null | undefined>(
    DEMO_MODE === "unpaired" ? null : DEMO_ENABLED ? DEMO_HOST : undefined,
  );
  const [list, setList] = useState<HostList>(DEMO_ENABLED && DEMO_MODE !== "unpaired" ? { hosts: [DEMO_HOST], activeId: "demo" } : { hosts: [], activeId: null });
  // For the actions below, which run outside render.
  const listRef = useRef(list);
  useEffect(() => {
    listRef.current = list;
  }, [list]);
  const apply = useCallback((next: HostList) => {
    listRef.current = next;
    setList(next);
  }, []);

  useEffect(() => {
    if (DEMO_ENABLED) return;
    loadHosts().then(
      (loaded) => {
        apply(loaded);
        setSettings(loaded.hosts.find((h) => h.id === loaded.activeId) ?? null);
      },
      () => setSettings(null),
    );
  }, [apply]);

  const updateHost = useCallback((host: SavedHost) => {
    void saveHost(host);
    setList((prev) => ({ ...prev, hosts: prev.hosts.map((h) => (h.id === host.id ? host : h)) }));
  }, []);

  const client = useMemo<HostConnection | null>(
    () =>
      DEMO_ENABLED && settings
        ? new DemoHost()
        : settings
        ? new HostClient(settings, {
            deviceName: deviceName(),
            onSettingsChange: (next) => updateHost({ ...next, id: settings.id }),
          })
        : null,
    [settings, updateHost],
  );

  useEffect(() => {
    if (!client) return;
    client.start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") client.reconnectNow();
    });
    return () => {
      sub.remove();
      client.stop();
    };
  }, [client]);

  const connect = useCallback(
    async (next: ConnectionSettings) => {
      const { hosts } = listRef.current;
      const existing = next.hostKey ? hosts.find((h) => h.hostKey === next.hostKey) : undefined;
      const host: SavedHost = { ...next, id: existing?.id ?? hostIdFor(next) };
      const updated = { hosts: existing ? hosts.map((h) => (h.id === host.id ? host : h)) : [...hosts, host], activeId: host.id };
      await saveHostList(updated);
      apply(updated);
      setSettings(host);
    },
    [apply],
  );

  const switchTo = useCallback(
    async (id: string) => {
      const host = listRef.current.hosts.find((h) => h.id === id);
      if (!host || listRef.current.activeId === id) return;
      const updated = { ...listRef.current, activeId: id };
      await saveHostList(updated);
      apply(updated);
      setSettings(host);
    },
    [apply],
  );

  const forget = useCallback(
    async (id?: string) => {
      const target = id ?? listRef.current.activeId;
      if (!target) return;
      const hosts = listRef.current.hosts.filter((h) => h.id !== target);
      const activeId = listRef.current.activeId === target ? (hosts[0]?.id ?? null) : listRef.current.activeId;
      const updated = { hosts, activeId };
      await deleteHost(target, updated);
      apply(updated);
      if (target === settings?.id) setSettings(hosts.find((h) => h.id === activeId) ?? null);
    },
    [apply, settings],
  );

  const value = useMemo(
    () => ({ settings, hosts: list.hosts, client, connect, switchTo, forget }),
    [settings, list.hosts, client, connect, switchTo, forget],
  );
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error("useConnection must be used inside ConnectionProvider");
  return value;
}

export function useHostState(): HostState {
  const { client } = useConnection();
  return useSyncExternalStore(client?.subscribe ?? noopSubscribe, client?.getState ?? (() => IDLE));
}
