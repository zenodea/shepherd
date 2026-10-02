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
};

export type AnswerEvent = { notificationId: number; paneId: string; key: string; label: string };

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
  notificationsEnabled(): boolean;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): Promise<void>;
}

/** Android only; null on the web, in tests and in Expo Go. */
export default requireOptionalNativeModule<ShepherdBackgroundModule>("ShepherdBackground");
