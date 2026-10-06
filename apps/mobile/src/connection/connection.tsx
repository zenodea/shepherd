import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { combineStores, peerHosts } from "./computers";
import { DEMO_ENABLED, DEMO_LAPTOP_SETTINGS, DEMO_MODE, DEMO_SETTINGS, DemoHost } from "./demo-host";
import { HostClient, type ConnectionSettings, type HostConnection, type HostState } from "./host-client";
import { forgetSaved, loadAgents, saveAgents } from "./offline-store";
import { deleteHost, hostIdFor, loadHosts, saveHost, saveHostList, type HostList, type SavedHost } from "./settings-store";

/** A paired computer and its connection. */
export type Computer = { host: SavedHost; client: HostConnection; active: boolean };

type ConnectionContextValue = {
  /** The computer in use; undefined while loading saved settings, null when none is paired. */
  settings: SavedHost | null | undefined;
  /** Every paired computer. */
  hosts: SavedHost[];
  client: HostConnection | null;
  /** Every paired computer with its connection, the one in use first. Empty until one is paired. */
  computers: Computer[];
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
const DEMO_LAPTOP: SavedHost = { ...DEMO_LAPTOP_SETTINGS, id: "demo-laptop" };

export function ConnectionProvider({ children }: { children: ReactNode }) {
  // `settings` changes only when you pair, switch or forget, which reconnects;
  // `hosts` also takes token and address updates from the host, which don't.
  const [settings, setSettings] = useState<SavedHost | null | undefined>(
    DEMO_MODE === "unpaired" ? null : DEMO_ENABLED ? DEMO_HOST : undefined,
  );
  const [list, setList] = useState<HostList>(
    DEMO_ENABLED && DEMO_MODE !== "unpaired" ? { hosts: [DEMO_HOST, DEMO_LAPTOP], activeId: DEMO_HOST.id } : { hosts: [], activeId: null },
  );
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

  const makeClient = useCallback(
    (host: SavedHost): HostConnection =>
      DEMO_ENABLED
        ? new DemoHost(host.id === DEMO_LAPTOP.id ? "laptop" : "studio")
        : new HostClient(host, {
            deviceName: deviceName(),
            onSettingsChange: (next) => updateHost({ ...next, id: host.id }),
            agents: loadAgents(host.id),
          }),
    [updateHost],
  );

  const client = useMemo<HostConnection | null>(() => (settings ? makeClient(settings) : null), [settings, makeClient]);

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

  // The other paired computers stay connected while the app is open, so the
  // home screen can show their agents too. They're replaced only when a
  // computer is added, removed or put in use (which already has its own
  // client); token and address updates are saved without reconnecting.
  const activeId = settings?.id ?? null;
  const peerKey = peerHosts(list.hosts, activeId)
    .map((h) => h.id)
    .join(",");
  const peers = useMemo(
    () => (activeId ? new Map(peerHosts(list.hosts, activeId).map((h) => [h.id, makeClient(h)])) : new Map<string, HostConnection>()),
    // `list.hosts` is read when the set of peers changes (`peerKey`), not on every token update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId, peerKey, makeClient],
  );
  // Only in the foreground: in the background just the computer in use stays connected.
  const [foreground, setForeground] = useState(AppState.currentState !== "background");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setForeground(state !== "background"));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!foreground) return;
    for (const peer of peers.values()) peer.start();
    return () => {
      for (const peer of peers.values()) peer.stop();
    };
  }, [peers, foreground]);

  const computers = useMemo<Computer[]>(() => {
    if (!settings || !client) return [];
    const active: Computer = { host: list.hosts.find((h) => h.id === settings.id) ?? settings, client, active: true };
    const others = peerHosts(list.hosts, settings.id).flatMap((host) => {
      const peer = peers.get(host.id);
      return peer ? [{ host, client: peer, active: false }] : [];
    });
    return [active, ...others];
  }, [settings, client, list.hosts, peers]);

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
      if (!DEMO_ENABLED) await saveHostList(updated);
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
      forgetSaved(target);
      apply(updated);
      if (target === settings?.id) setSettings(hosts.find((h) => h.id === activeId) ?? null);
    },
    [apply, settings],
  );

  // Each computer's agents, kept on the phone while connected, for reading without a connection next time.
  useEffect(() => {
    if (DEMO_ENABLED) return;
    const stops = computers.map(({ host, client: c }) => {
      let last = "";
      let timer: ReturnType<typeof setTimeout> | null = null;
      const save = () => {
        const state = c.getState();
        if (state.status !== "online") return;
        const json = JSON.stringify(state.agents);
        if (json === last) return;
        last = json;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => saveAgents(host.id, state.agents), 2000);
      };
      const unsubscribe = c.subscribe(save);
      return () => {
        unsubscribe();
        if (timer) clearTimeout(timer);
      };
    });
    return () => stops.forEach((stop) => stop());
  }, [computers]);

  const value = useMemo(
    () => ({ settings, hosts: list.hosts, client, computers, connect, switchTo, forget }),
    [settings, list.hosts, client, computers, connect, switchTo, forget],
  );
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error("useConnection must be used inside ConnectionProvider");
  return value;
}

export function useHostState(): HostState {
  return useClientState(useConnection().client);
}

/** A connection's state (idle without one). */
export function useClientState(client: HostConnection | null): HostState {
  return useSyncExternalStore(client?.subscribe ?? noopSubscribe, client?.getState ?? (() => IDLE));
}

/** Each computer's state, in the same order; a new array only when one of them changes. */
export function useComputerStates(computers: Computer[]): HostState[] {
  const store = useMemo(() => combineStores(computers.map((c) => c.client)), [computers]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
