import { useSyncExternalStore } from "react";
import { loadPref, savePref } from "../connection/prefs";

// "Show images in conversations": load them as they appear. Off, they show as
// a line you can tap to load one.

const PREF = "images";
let enabled = false;
const listeners = new Set<() => void>();

void loadPref(PREF).then((v) => {
  enabled = v === "on";
  listeners.forEach((l) => l());
});

export function useImagesShown(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => enabled,
  );
}

export function setImagesShown(on: boolean): void {
  enabled = on;
  listeners.forEach((l) => l());
  void savePref(PREF, on ? "on" : "off");
}
