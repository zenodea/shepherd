import { useSyncExternalStore } from "react";
import { loadPref, savePref } from "./prefs";

/** An on/off preference kept on the phone, readable from components and from plain code. */
export function prefSwitch(key: string, initial: boolean) {
  let value = initial;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  void loadPref(key).then((v) => {
    if (v === null) return;
    value = v === "on";
    notify();
  });
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  return {
    get: () => value,
    use: () => useSyncExternalStore(subscribe, () => value),
    set: (on: boolean) => {
      value = on;
      notify();
      void savePref(key, on ? "on" : "off");
    },
  };
}
