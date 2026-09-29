import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { TerminalFrame } from "../connection/host-client";
import { TERMINAL_HTML } from "./terminal-html.generated";

export type TerminalViewMode = "native" | "fit";

export type TerminalViewHandle = {
  write: (frame: TerminalFrame) => void;
  /** Earlier output (base64 ANSI), written before the live screen so it can be scrolled back to. */
  writeHistory: (bytes: string) => void;
  reset: () => void;
  setMode: (mode: TerminalViewMode) => void;
  scrollToBottom: () => void;
};

type Props = {
  onReady: () => void;
  /** In fit mode, the size that fills the view at a readable font. */
  onFitSize: (cols: number, rows: number) => void;
  /** A tap on the terminal (used to dismiss the keyboard). */
  onTap?: () => void;
  /** The view reached or left the bottom of the scrollback (full-width mode). */
  onScrollChange?: (atBottom: boolean) => void;
  /** Fit mode: the user dragged to scroll; positive lines = back in time. */
  onWheel?: (lines: number) => void;
};

type FrameMessage = Pick<TerminalFrame, "width" | "height" | "bytes">;
type PageMessage =
  | { type: "ready" }
  | { type: "fitSize"; cols: number; rows: number }
  | { type: "tap" }
  | { type: "scroll"; atBottom: boolean }
  | { type: "wheel"; lines: number };

const FLUSH_MS = 16;

/** xterm.js in a WebView. Frames are batched into one injection per tick. */
export const TerminalView = forwardRef<TerminalViewHandle, Props>(function TerminalView({ onReady, onFitSize, onTap, onScrollChange, onWheel }, ref) {
  const webView = useRef<WebView>(null);
  const queue = useRef<FrameMessage[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inject = useCallback((msg: unknown) => {
    webView.current?.injectJavaScript(`window.__sheperd && window.__sheperd(${JSON.stringify(msg)}); true;`);
  }, []);

  const flush = useCallback(() => {
    flushTimer.current = null;
    const frames = queue.current;
    queue.current = [];
    if (frames.length > 0) inject({ type: "frames", frames });
  }, [inject]);

  useImperativeHandle(
    ref,
    () => ({
      write: (frame) => {
        queue.current.push({ width: frame.width, height: frame.height, bytes: frame.bytes });
        if (!flushTimer.current) flushTimer.current = setTimeout(flush, FLUSH_MS);
      },
      writeHistory: (bytes) => {
        flush();
        inject({ type: "history", bytes });
      },
      reset: () => {
        queue.current = [];
        inject({ type: "reset" });
      },
      setMode: (mode) => inject({ type: "mode", mode }),
      scrollToBottom: () => inject({ type: "scrollToBottom" }),
    }),
    [flush, inject],
  );

  const onMessage = (event: WebViewMessageEvent) => {
    let msg: PageMessage;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === "ready") onReady();
    else if (msg.type === "fitSize") onFitSize(msg.cols, msg.rows);
    else if (msg.type === "tap") onTap?.();
    else if (msg.type === "scroll") onScrollChange?.(msg.atBottom);
    else if (msg.type === "wheel") onWheel?.(msg.lines);
  };

  return (
    <WebView
      ref={webView}
      source={{ html: TERMINAL_HTML }}
      originWhitelist={["*"]}
      onMessage={onMessage}
      style={styles.webview}
      javaScriptEnabled
      scrollEnabled={false}
      setBuiltInZoomControls
      setDisplayZoomControls={false}
      overScrollMode="never"
      keyboardDisplayRequiresUserAction={false}
      hideKeyboardAccessoryView
      automaticallyAdjustContentInsets={false}
      textZoom={100}
    />
  );
});

const styles = StyleSheet.create({
  webview: { flex: 1, backgroundColor: "#0A0C0F" },
});
