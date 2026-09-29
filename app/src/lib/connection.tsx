import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { HostClient, type ConnectionSettings, type HostState } from "./host-client";
import { clearSettings, loadSettings, saveSettings } from "./settings-store";

type ConnectionContextValue = {
  /** undefined while loading saved settings */
  settings: ConnectionSettings | null | undefined;
  client: HostClient | null;
  connect: (settings: ConnectionSettings) => Promise<void>;
  forget: () => Promise<void>;
};

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

const IDLE: HostState = { status: "idle", error: null, host: null, agents: [] };
const noopSubscribe = () => () => {};

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ConnectionSettings | null | undefined>(undefined);

  useEffect(() => {
    loadSettings().then(setSettings, () => setSettings(null));
  }, []);

  const client = useMemo(() => (settings ? new HostClient(settings) : null), [settings]);

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

  const connect = useCallback(async (next: ConnectionSettings) => {
    await saveSettings(next);
    setSettings(next);
  }, []);

  const forget = useCallback(async () => {
    await clearSettings();
    setSettings(null);
  }, []);

  const value = useMemo(() => ({ settings, client, connect, forget }), [settings, client, connect, forget]);
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
