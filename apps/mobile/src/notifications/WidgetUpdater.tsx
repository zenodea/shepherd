import { useEffect } from "react";
import Background from "../../modules/shepherd-background/src/ShepherdBackgroundModule";
import { useConnection } from "../connection/connection";
import { DEMO_ENABLED } from "../connection/demo-host";
import { readPrompt } from "./agent-prompt";
import { askingAgent, widgetAsk, widgetSummary, type WidgetAsk } from "./widget";

/**
 * Keeps the home-screen widget current: redraws it when what it shows
 * changes. Straight from the connection, so it keeps going in the background
 * while notifications keep the app running.
 */
const ASK_REFRESH_MS = 15_000;

export function WidgetUpdater() {
  const { client, settings } = useConnection();
  const hostName = settings?.name ?? null;
  const hostId = settings?.id ?? null;

  useEffect(() => {
    const native = Background;
    if (!native || DEMO_ENABLED) return;
    let shown = "";
    let asked: { key: string; ask: WidgetAsk | null } = { key: "", ask: null };
    const push = () => {
      const state = client?.getState() ?? { status: "idle" as const, network: true, error: null, host: null, activeUrl: null, urls: [], device: null, agents: [] };
      const agent = askingAgent(state);
      // Re-read when it asks something else, or now and then: the next of several questions keeps it blocked.
      const key = agent ? `${agent.pane_id}:${agent.revision}:${Math.floor(Date.now() / ASK_REFRESH_MS)}` : "";
      if (agent && client && key !== asked.key) {
        asked = { key, ask: null };
        void readPrompt(client, agent.pane_id)
          .then((prompt) => {
            if (asked.key !== key) return;
            asked = { key, ask: widgetAsk(agent, prompt, hostId) };
            push();
          })
          .catch(() => {});
      }
      if (!agent) asked = { key: "", ask: null };
      const summary = { ...widgetSummary(state, hostName, hostId), ...(asked.ask ? { ask: asked.ask } : {}) };
      const { at: _at, ...content } = summary;
      const drawn = JSON.stringify(content);
      if (drawn === shown) return;
      shown = drawn;
      void native.updateWidget(JSON.stringify(summary)).catch(() => {});
    };
    push();
    return client?.subscribe(push);
  }, [client, hostName, hostId]);

  return null;
}
