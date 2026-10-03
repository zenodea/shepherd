import { useEffect } from "react";
import Background from "../../modules/shepherd-background/src/ShepherdBackgroundModule";
import { useConnection } from "../connection/connection";
import { DEMO_ENABLED } from "../connection/demo-host";
import { widgetSummary } from "./widget";

/**
 * Keeps the home-screen widget current: redraws it when what it shows
 * changes. Straight from the connection, so it keeps going in the background
 * while notifications keep the app running.
 */
export function WidgetUpdater() {
  const { client, settings } = useConnection();
  const hostName = settings?.name ?? null;
  const hostId = settings?.id ?? null;

  useEffect(() => {
    const native = Background;
    if (!native || DEMO_ENABLED) return;
    let shown = "";
    const push = () => {
      const summary = widgetSummary(client?.getState() ?? { status: "idle", error: null, host: null, activeUrl: null, urls: [], device: null, agents: [] }, hostName, hostId);
      const { at: _at, ...content } = summary;
      const key = JSON.stringify(content);
      if (key === shown) return;
      shown = key;
      void native.updateWidget(JSON.stringify(summary)).catch(() => {});
    };
    push();
    return client?.subscribe(push);
  }, [client, hostName, hostId]);

  return null;
}
