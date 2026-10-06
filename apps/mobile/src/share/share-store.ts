import { useSyncExternalStore } from "react";
import type { SharedContent } from "../../modules/shepherd-background/src/ShepherdBackgroundModule";

// What's waiting to be sent from the share screen; it outlives reconnects and computer switches.
let current: SharedContent | null = null;
const listeners = new Set<() => void>();

export function setShared(next: SharedContent | null): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useShared(): SharedContent | null {
  return useSyncExternalStore(subscribe, () => current);
}
