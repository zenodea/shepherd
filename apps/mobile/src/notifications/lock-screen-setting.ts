import { prefSwitch } from "../connection/pref-switch";

/** Answering from a notification on the lock screen without unlocking first. Off: Android asks for your fingerprint or screen lock. */
const unlocked = prefSwitch("answerUnlocked", false);

export const useAnswerUnlocked = unlocked.use;
export const setAnswerUnlocked = unlocked.set;
