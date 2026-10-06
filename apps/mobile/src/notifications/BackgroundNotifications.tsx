import { useEffect, useRef } from "react";
import { AppRegistry, AppState } from "react-native";
import type { AgentInfo, ConversationResult, StatusChange } from "@shepherd/protocol";
import Background, { type AnswerEvent } from "../../modules/shepherd-background/src/ShepherdBackgroundModule";
import { useConnection, useHostState } from "../connection/connection";
import type { HostConnection, HostState } from "../connection/host-client";
import { DEMO_ENABLED } from "../connection/demo-host";
import { useAppLock } from "../security/app-lock";
import { useAnswerUnlocked } from "./lock-screen-setting";
import { sendAnswer } from "../agents/answer";
import { notificationId, readPrompt, settledPrompt } from "./agent-prompt";
import { Cooldown, agentLabel, alertFor, excerpt, missedChanges, stillOffered, withPrompt } from "./rules";
import { NOTIFICATIONS_SUPPORTED, useNotificationsEnabled } from "./setting";

/** After answering from a notification, when to look for the next question. */
const FOLLOW_UP_MS = 1500;
/** How long "Sent “Yes” to claude" and similar stay up. */
const CONFIRMATION_MS = 6000;
/** Nothing from the host for this long (it pings every 30 s, the app every 15 s): reconnect. */
const STALE_MS = 45_000;

// Keeps JS timers (reconnects, heartbeats) running in the background; the
// native module starts it with the background service and finishes it on stop.
if (NOTIFICATIONS_SUPPORTED) AppRegistry.registerHeadlessTask("ShepherdKeepAlive", () => () => new Promise<void>(() => {}));


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

/** The opening of the agent's last reply, from its conversation; null when there's none. */
async function lastReply(client: HostConnection, paneId: string): Promise<string | null> {
  const result = await client.call<ConversationResult>("shepherd.conversation", { paneId, limit: 40 });
  if (!result.available) return null;
  const last = [...result.entries].reverse().find((e) => e.kind === "assistant");
  return last && last.kind === "assistant" ? excerpt(last.text) || null : null;
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
  const requireAuth = !useAnswerUnlocked();
  const privateContent = useAppLock().enabled === true;

  // Run the background service while notifications are on. Android only lets it
  // start while the app is visible, so (re)start it whenever the app comes forward.
  // What the permanent notification says, so restarting the service doesn't put back "Connecting…".
  const ongoing = useRef({ title: "Shepherd", text: "Connecting…" });
  useEffect(() => {
    const native = Background;
    if (!active || !native) return;
    const start = () => void native.start(ongoing.current.title, ongoing.current.text).catch(() => {});
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
    const refresh = () => {
      const next = connectionText(client.getState());
      if (next.title === ongoing.current.title && next.text === ongoing.current.text) return;
      ongoing.current = next;
      void native.update(next.title, next.text).catch(() => {});
    };
    ongoing.current = { title: "", text: "" };
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
  const latest = useRef({ hostId, hostName, active, requireAuth, privateContent });
  useEffect(() => {
    latest.current = { hostId, hostName, active, requireAuth, privateContent };
  });

  // Agents that need you or finished, while you're not looking at the app, and
  // the answer buttons on those notifications.
  useEffect(() => {
    const native = Background;
    if (!client || !native) return;
    const cooldown = new Cooldown();
    // What happened to each alert, in the computer's Shepherd log: nothing on a phone shows why one didn't come.
    const report = (text: string) => void client.call("shepherd.log", { text }).catch(() => {});

    /** Post the notification for a change (`again`: a follow-up question, so skip the cooldown). */
    const post = async (change: StatusChange, again = false) => {
      const { hostId, hostName, requireAuth, privateContent } = latest.current;
      const alert = alertFor(change, hostName);
      if (!alert || (!again && !cooldown.allow(`${change.paneId}:${change.status}`))) return;
      let content: ReturnType<typeof withPrompt> = { alert, actions: [], write: null };
      if (alert.kind === "blocked") content = withPrompt(alert, await settledPrompt(client, change.paneId).catch(() => null));
      // Finished: what it said last, so you may not need to open it.
      if (alert.kind === "done") {
        const said = await lastReply(client, change.paneId).catch(() => null);
        if (said) content = { ...content, alert: { ...alert, body: `${said}\n${alert.body}` } };
      }
      const name = agentLabel(change.agent, change.paneId);
      const reply =
        alert.kind === "done"
          ? { replyHint: `Message ${name}…` }
          : content.write
            ? { replyHint: `Answer ${name}…`, replyKey: content.write.key, replyLabel: content.write.label }
            : {};
      const channel = alert.kind === "blocked" ? "input" : "finished";
      await native
        .notify({
          id: notificationId(change.paneId),
          channel,
          title: content.alert.title,
          body: content.alert.body,
          url: agentLink(change.paneId, hostId),
          paneId: change.paneId,
          answers: content.actions,
          timeoutMs: 0,
          ...reply,
          requireAuth,
          privateContent,
        })
        .then(
          (result) => {
            report(`"${content.alert.title}": ${result}`);
            // Still there a moment later? If not, something removed it before you could see it.
            const id = notificationId(change.paneId);
            setTimeout(() => report(`"${content.alert.title}" after 3 s: ${native.isShowing(id) ? "still showing" : "gone"} (${native.notificationState(channel)})`), 3000);
          },
          (err: Error) => report(`couldn't show "${content.alert.title}": ${err.message}`),
        );
    };

    const onChange = (change: StatusChange) => {
      if (!latest.current.active) return;
      // Answered somewhere else: the question is gone, so is its notification.
      if (change.previous === "blocked" && change.status !== "blocked") {
        report(`removing ${change.paneId}'s notification: it stopped waiting (${change.previous} → ${change.status})`);
        void native.cancel(notificationId(change.paneId)).catch(() => {});
      }
      if (AppState.currentState === "active") {
        if (alertFor(change, "")) report(`no notification for ${change.paneId} (${change.previous} → ${change.status}): Shepherd is open`);
        return;
      }
      void post(change).catch((err: Error) => report(`couldn't notify ${change.paneId} (${change.previous} → ${change.status}): ${err.message}`));
    };
    const unsubscribeChanges = client.onStatusChange(onChange);
    const dismissed = native.addListener("onDismiss", (event) => report(`notification ${event.notificationId} dismissed by Android or by you`));

    // The host sends changes as they happen; if the connection was down when an
    // agent finished or started asking, catch up from the snapshot on reconnecting.
    let known = new Map<string, AgentInfo>();
    let online = false;
    const unsubscribeState = client.subscribe(() => {
      const state = client.getState();
      if (state.status !== "online") {
        online = false;
        return;
      }
      if (!online && known.size) for (const change of missedChanges(known, state.agents)) onChange(change);
      online = true;
      known = new Map(state.agents.map((a) => [a.pane_id, a]));
    });

    /** After an answer: if the agent asks something else straight away (the next of several questions), notify that too. */
    const followUp = async (event: AnswerEvent) => {
      await new Promise((r) => setTimeout(r, FOLLOW_UP_MS));
      const agent = client.getState().agents.find((a) => a.pane_id === event.paneId) ?? null;
      if (agent?.agent_status !== "blocked" || AppState.currentState === "active") return;
      const prompt = await readPrompt(client, event.paneId);
      if (prompt.options.length === 0 || stillOffered(prompt, event)) return;
      await post({ type: "agent.status", paneId: event.paneId, status: "blocked", previous: "working", agent }, true);
    };

    // An answer button: send it only if the agent is still asking the same thing.
    const answers = native.addListener("onAnswer", (event: AnswerEvent) => {
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
          if (event.reply != null && event.key) {
            // An answer you write ("Type something."): pick the option, then type it, if it's still on offer.
            const text = event.reply.trim();
            if (!text) return await outcome("Nothing to send.", false);
            if (agent?.agent_status !== "blocked") return await outcome("It isn't waiting for an answer any more.", false);
            if (!stillOffered(await readPrompt(client, event.paneId), event)) return await outcome("It's asking something else now. Tap to open it.", false);
            await sendAnswer(client, event.paneId, event, text);
            await native.notify({
              id: event.notificationId,
              channel: "input",
              title: `Answered ${name}`,
              body: text,
              url: agentLink(event.paneId, hostId),
              paneId: event.paneId,
              answers: [],
              timeoutMs: CONFIRMATION_MS,
            });
            return await followUp(event);
          }
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
          await sendAnswer(client, event.paneId, event);
          await outcome(agent.terminal_title_stripped || agent.cwd?.split("/").pop() || "", true);
          await followUp(event);
        } catch {
          await outcome("Couldn't reach your computer. Tap to open Shepherd.", false);
        }
      })().catch(() => {});
    });

    return () => {
      unsubscribeChanges();
      dismissed.remove();
      unsubscribeState();
      answers.remove();
    };
  }, [client]);

  return null;
}
