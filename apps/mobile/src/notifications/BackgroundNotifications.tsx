import { useEffect, useRef } from "react";
import { AppRegistry, AppState } from "react-native";
import { extractPrompt, type AgentInfo, type PaneReadResult, type StatusChange } from "@shepherd/protocol";
import Background, { type AnswerEvent } from "../../modules/shepherd-background/src/ShepherdBackgroundModule";
import { useConnection, useHostState } from "../connection/connection";
import type { HostConnection, HostState } from "../connection/host-client";
import { DEMO_ENABLED } from "../connection/demo-host";
import { useAppLock } from "../security/app-lock";
import { Cooldown, agentLabel, alertFor, stillOffered, withPrompt } from "./rules";
import { NOTIFICATIONS_SUPPORTED, useNotificationsEnabled } from "./setting";

/** How long "Sent “Yes” to claude" and similar stay up. */
const CONFIRMATION_MS = 6000;
/** Nothing from the host for this long (it pings every 30 s, the app every 15 s): reconnect. */
const STALE_MS = 45_000;

// Keeps JS timers (reconnects, heartbeats) running in the background; the
// native module starts it with the background service and finishes it on stop.
if (NOTIFICATIONS_SUPPORTED) AppRegistry.registerHeadlessTask("ShepherdKeepAlive", () => () => new Promise<void>(() => {}));

/** A stable notification id per pane: its alert, and one below it for the outcome of a button. */
function notificationId(paneId: string): number {
  let hash = 7;
  for (const ch of paneId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return (Math.abs(hash) % 1_000_000) * 2 + 2;
}

function agentLink(paneId: string, hostId: string | null): string {
  return `shepherd://agent/${encodeURIComponent(paneId)}${hostId ? `?host=${hostId}` : ""}`;
}

/** The permanent notification's text: what your agents are doing. */
function connectionText(state: HostState): { title: string; text: string } {
  const title = state.host?.name ? `Shepherd · ${state.host.name}` : "Shepherd";
  if (state.status !== "online") return { title, text: state.status === "unauthorized" ? "This phone was unpaired" : "Reconnecting…" };
  const blocked = state.agents.filter((a) => a.agent_status === "blocked").length;
  const working = state.agents.filter((a) => a.agent_status === "working").length;
  const parts = [`${state.agents.length} agent${state.agents.length === 1 ? "" : "s"}`];
  if (blocked) parts.push(`${blocked} need${blocked === 1 ? "s" : ""} you`);
  if (working) parts.push(`${working} working`);
  return { title, text: parts.join(" · ") };
}

async function readPrompt(client: HostConnection, paneId: string) {
  const { read } = await client.call<{ read: PaneReadResult }>("agent.read", { target: paneId, source: "visible", format: "text" });
  return extractPrompt(read.text);
}

/**
 * The question an agent just asked. It may still be drawing its answers, so
 * read again if there are none yet; the round trip is the wait (a JS timer
 * wouldn't fire while the app is in the background).
 */
async function settledPrompt(client: HostConnection, paneId: string) {
  const first = await readPrompt(client, paneId);
  return first.options.length > 0 ? first : readPrompt(client, paneId);
}

/**
 * Background notifications without a push service: while they're on, a
 * foreground service keeps the app connected to the computer, and the app
 * turns "needs input" and "finished" into notifications with answer buttons.
 */
export function BackgroundNotifications() {
  const enabled = useNotificationsEnabled();
  const { client, settings } = useConnection();
  const state = useHostState();
  const active = NOTIFICATIONS_SUPPORTED && !DEMO_ENABLED && enabled === true && settings !== null;
  const hostId = settings?.id ?? null;
  const hostName = state.host?.name ?? settings?.name ?? "your computer";
  // With App lock on, answering from a notification asks for the fingerprint too.
  const requireAuth = useAppLock().enabled === true;

  // Run the background service while notifications are on. Android only lets it
  // start while the app is visible, so (re)start it whenever the app comes forward.
  useEffect(() => {
    const native = Background;
    if (!active || !native) return;
    const start = () => void native.start("Shepherd", "Connecting…").catch(() => {});
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (s) => s === "active" && start());
    return () => {
      sub.remove();
      void native.stop().catch(() => {});
    };
  }, [active]);

  // Keep the permanent notification up to date, and the connection alive, from
  // the connection and the native tick directly: React effects and JS timers
  // can't be relied on while Android has the app in the background.
  useEffect(() => {
    const native = Background;
    if (!active || !native || !client) return;
    let shown = "";
    const refresh = () => {
      const { title, text } = connectionText(client.getState());
      if (`${title}\n${text}` === shown) return;
      shown = `${title}\n${text}`;
      void native.update(title, text).catch(() => {});
    };
    refresh();
    const unsubscribe = client.subscribe(refresh);
    const tick = native.addListener("onTick", () => {
      client.checkConnection(STALE_MS);
      refresh();
    });
    return () => {
      unsubscribe();
      tick.remove();
    };
  }, [active, client]);

  // Latest values for the listeners below, which are set up once per client.
  const latest = useRef({ hostId, hostName, active, requireAuth });
  useEffect(() => {
    latest.current = { hostId, hostName, active, requireAuth };
  });

  // Agents that need you or finished, while you're not looking at the app.
  useEffect(() => {
    const native = Background;
    if (!client || !native) return;
    const cooldown = new Cooldown();
    const onChange = (change: StatusChange) => {
      const { active, hostId, hostName, requireAuth } = latest.current;
      if (!active) return;
      const id = notificationId(change.paneId);
      // Answered somewhere else: the question is gone, so is its notification.
      if (change.previous === "blocked" && change.status !== "blocked") void native.cancel(id).catch(() => {});
      if (AppState.currentState === "active") return;
      const alert = alertFor(change, hostName);
      if (!alert || !cooldown.allow(`${change.paneId}:${change.status}`)) return;
      void (async () => {
        let content = { alert, actions: [] as { key: string; label: string }[] };
        if (alert.kind === "blocked") content = withPrompt(alert, await settledPrompt(client, change.paneId).catch(() => null));
        await native.notify({
          id,
          channel: alert.kind === "blocked" ? "input" : "finished",
          title: content.alert.title,
          body: content.alert.body,
          url: agentLink(change.paneId, hostId),
          paneId: change.paneId,
          answers: content.actions,
          timeoutMs: 0,
          // Finished: say what's next from the notification.
          ...(alert.kind === "done" ? { replyHint: `Message ${agentLabel(change.agent, change.paneId)}…` } : {}),
          requireAuth,
        });
      })().catch(() => {});
    };
    return client.onStatusChange(onChange);
  }, [client]);

  // An answer button: send it only if the agent is still asking the same thing.
  useEffect(() => {
    const native = Background;
    if (!client || !native) return;
    const sub = native.addListener("onAnswer", (event: AnswerEvent) => {
      void (async () => {
        const { hostId } = latest.current;
        const agent: AgentInfo | null = client.getState().agents.find((a) => a.pane_id === event.paneId) ?? null;
        const name = agentLabel(agent, event.paneId);
        const outcome = (text: string, sent: boolean) =>
          native.notify({
            id: event.notificationId,
            channel: "input",
            title: sent ? `Sent “${event.label}” to ${name}` : `Couldn't answer ${name}`,
            body: text,
            url: agentLink(event.paneId, hostId),
            paneId: event.paneId,
            answers: [],
            timeoutMs: sent ? CONFIRMATION_MS : 0,
          });
        try {
          if (event.reply != null) {
            const text = event.reply.trim();
            if (!text) return await outcome("Nothing to send.", false);
            // herdr refuses a message while the agent is asking something: it would become the answer.
            if (agent?.agent_status === "blocked") return await outcome(`${name} is asking something. Tap to answer it first.`, false);
            await client.call("agent.prompt", { target: event.paneId, text });
            return await native.notify({
              id: event.notificationId,
              channel: "finished",
              title: `Sent to ${name}`,
              body: text,
              url: agentLink(event.paneId, hostId),
              paneId: event.paneId,
              answers: [],
              timeoutMs: CONFIRMATION_MS,
            });
          }
          if (agent?.agent_status !== "blocked") return await outcome("It isn't waiting for an answer any more.", false);
          const prompt = await readPrompt(client, event.paneId);
          if (!stillOffered(prompt, event)) return await outcome("It's asking something else now. Tap to open it.", false);
          await client.call("agent.send_keys", { target: event.paneId, keys: [event.key] });
          await outcome(agent.terminal_title_stripped || agent.cwd?.split("/").pop() || "", true);
        } catch {
          await outcome("Couldn't reach your computer. Tap to open Shepherd.", false);
        }
      })().catch(() => {});
    });
    return () => sub.remove();
  }, [client]);

  return null;
}
