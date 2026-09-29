import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { DEMO_ENABLED, DEMO_MODE, DEMO_SETTINGS, DemoHost } from "./demo-host";
import { HostClient, type ConnectionSettings, type HostConnection, type HostState } from "./host-client";
import { clearSettings, loadSettings, saveSettings } from "./settings-store";

type ConnectionContextValue = {
  /** undefined while loading saved settings */
  settings: ConnectionSettings | null | undefined;
  client: HostConnection | null;
  connect: (settings: ConnectionSettings) => Promise<void>;
  forget: () => Promise<void>;
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

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ConnectionSettings | null | undefined>(
    DEMO_MODE === "unpaired" ? null : DEMO_ENABLED ? DEMO_SETTINGS : undefined,
  );

  useEffect(() => {
    if (!DEMO_ENABLED) loadSettings().then(setSettings, () => setSettings(null));
  }, []);

  // Re-created only when the user pairs or forgets a host; token and address
  // updates from the host are saved without reconnecting.
  const client = useMemo<HostConnection | null>(
    () =>
      DEMO_ENABLED && settings
        ? new DemoHost()
        : settings
        ? new HostClient(settings, {
            deviceName: deviceName(),
            onSettingsChange: (next) => void saveSettings(next),
          })
        : null,
    [settings],
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
