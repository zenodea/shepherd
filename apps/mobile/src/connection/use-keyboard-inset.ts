import { useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, Platform } from "react-native";

/**
 * How much bottom space the keyboard needs. On Android the window may or may
 * not shrink for the keyboard (it depends on edge-to-edge and the host app,
 * e.g. Expo Go), so measure: if the window got shorter by about the keyboard
 * height, it already made room and no inset is needed.
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
        const shrunk = baseHeight.current - Dimensions.get("window").height;
        const resized = shrunk > keyboard * 0.5;
        setState({ inset: resized ? 0 : keyboard, visible: true });
      }, Platform.OS === "android" ? 60 : 0);
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
