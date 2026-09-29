import { useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, Platform } from "react-native";

/** Breathing room between the composer and the top of the keyboard. */
const MARGIN = 14;

/**
 * How much bottom space the keyboard needs. On Android the window may shrink
 * for the keyboard fully, partly (e.g. not for the suggestion strip), or not
 * at all, depending on edge-to-edge and the host app (Expo Go), so measure
 * what's still covered: the keyboard's height minus however much the window
 * shrank, or the overlap between the keyboard's top edge and the window's
 * bottom, whichever is larger. Plus a small margin.
 */
export function useKeyboardInset(): { inset: number; visible: boolean } {
  const [state, setState] = useState({ inset: 0, visible: false });
  const baseHeight = useRef(Dimensions.get("window").height);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (e) => {
      const keyboard = e.endCoordinates.height;
      // Give the window a moment to resize, then decide.
      setTimeout(() => {
        const window = Dimensions.get("window").height;
        const shrunk = Math.max(0, baseHeight.current - window);
        const overlap = Math.max(0, window - e.endCoordinates.screenY);
        const covered = Math.max(keyboard - shrunk, overlap);
        setState({ inset: Math.max(0, Math.round(covered)) + MARGIN, visible: true });
      }, Platform.OS === "android" ? 80 : 0);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      baseHeight.current = Dimensions.get("window").height;
      setState({ inset: 0, visible: false });
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return state;
}
