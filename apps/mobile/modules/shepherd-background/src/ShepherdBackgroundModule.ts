import { NativeModule, requireOptionalNativeModule } from "expo";

export type Answer = { key: string; label: string };

export type AgentNotification = {
  /** Same id replaces the notification. */
  id: number;
  channel: "input" | "finished";
  title: string;
  body: string;
  /** Where a tap goes: a shepherd:// link. */
  url: string;
  paneId: string;
  /** Up to three buttons. */
  answers: Answer[];
  /** Remove it after this long; 0 keeps it. */
  timeoutMs: number;
  /** Adds a Reply box that sends text to the agent, with this hint. */
  replyHint?: string;
  /** The Reply box answers this option (one you write yourself) instead of sending a new message. */
  replyKey?: string;
  /** The Reply box's button, e.g. "Type something."; "Reply" by default. */
  replyLabel?: string;
  /** Answering from the lock screen asks to unlock first. */
  requireAuth?: boolean;
  /** Hide the content on the lock screen (App lock). */
  privateContent?: boolean;
};

/** A pressed answer button, or (with `reply`) text typed into the Reply box. */
export type AnswerEvent = { notificationId: number; paneId: string; key: string; label: string; reply?: string | null };

type Events = {
  onAnswer: (event: AnswerEvent) => void;
  /** Every 15 s while the background service runs, even when JS timers are paused. */
  onTick: () => void;
};

declare class ShepherdBackgroundModule extends NativeModule<Events> {
  /** Start staying connected in the background, with a permanent notification. Call while the app is visible. */
  start(title: string, text: string): Promise<void>;
  update(title: string, text: string): Promise<void>;
  stop(): Promise<boolean>;
  notify(notification: AgentNotification): Promise<void>;
  cancel(id: number): Promise<void>;
  /** Redraw the home-screen widget from this summary (JSON of a WidgetSummary). */
  updateWidget(json: string): Promise<void>;
  /** Saves an image (base64) into Pictures/Shepherd; resolves to its content URI. Android 10+. */
  saveImage(base64: string, mime: string, name: string): Promise<string>;
  notificationsEnabled(): boolean;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): Promise<void>;
}

/** Android only; null on the web, in tests and in Expo Go. */
export default requireOptionalNativeModule<ShepherdBackgroundModule>("ShepherdBackground");
