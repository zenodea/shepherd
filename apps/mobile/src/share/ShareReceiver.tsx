import { usePathname, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import Background, { type SharedContent } from "../../modules/shepherd-background/src/ShepherdBackgroundModule";
import { useConnection } from "../connection/connection";
import { useAppLock } from "../security/app-lock";
import { setShared } from "./share-store";

/**
 * Takes what another app shared to Shepherd (when it opens the app, or while
 * it's running) and opens the share screen with it, once the app is unlocked.
 */
export function ShareReceiver() {
  const router = useRouter();
  const pathname = usePathname();
  const { settings } = useConnection();
  const { unlocked } = useAppLock();
  // Set when a share comes in, until the share screen is opened for it.
  const toOpen = useRef(false);
  const [arrived, setArrived] = useState(0);

  useEffect(() => {
    const native = Background;
    if (!native) return;
    const take = () =>
      native.takeShare().then(
        (content: SharedContent | null) => {
          if (!content) return;
          setShared(content);
          toOpen.current = true;
          setArrived((n) => n + 1);
        },
        () => {},
      );
    void take();
    const shared = native.addListener("onShare", () => void take());
    // In case the event came while JS wasn't listening.
    const state = AppState.addEventListener("change", (s) => {
      if (s === "active") void take();
    });
    return () => {
      shared.remove();
      state.remove();
    };
  }, []);

  // Waits for the lock and for the saved computers, so the home screen's own redirects have settled.
  useEffect(() => {
    if (!toOpen.current || !unlocked || settings === undefined) return;
    toOpen.current = false;
    // Already open: it shows the new share.
    if (pathname !== "/share") router.push("/share");
  }, [arrived, unlocked, settings, pathname, router]);

  return null;
}
