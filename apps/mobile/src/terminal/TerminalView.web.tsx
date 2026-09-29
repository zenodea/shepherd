// Web (demo previews only): the same terminal page in an iframe.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { TerminalFrame } from "../connection/host-client";
import { TERMINAL_HTML } from "./terminal-html.generated";
import type { TerminalViewHandle, TerminalViewMode } from "./TerminalView";

type Props = {
  onReady: () => void;
  onFitSize: (cols: number, rows: number) => void;
  onTap?: () => void;
  onScrollChange?: (atBottom: boolean) => void;
  onWheel?: (lines: number) => void;
  onInput?: (data: string) => void;
};

export const TerminalView = forwardRef<TerminalViewHandle, Props>(function TerminalView({ onReady, onFitSize, onTap, onScrollChange, onWheel, onInput }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const call = (msg: unknown) => (frame.current?.contentWindow as { __sheperd?: (m: unknown) => void } | null)?.__sheperd?.(msg);

  useEffect(() => {
    const win = frame.current?.contentWindow as (Window & { ReactNativeWebView?: unknown }) | null | undefined;
    if (!win) return;
    // The page talks to React Native through ReactNativeWebView.postMessage.
    win.ReactNativeWebView = {
      postMessage: (raw: string) => {
        const msg = JSON.parse(raw);
        if (msg.type === "fitSize") onFitSize(msg.cols, msg.rows);
        else if (msg.type === "tap") onTap?.();
        else if (msg.type === "scroll") onScrollChange?.(msg.atBottom);
        else if (msg.type === "wheel") onWheel?.(msg.lines);
        else if (msg.type === "input") onInput?.(msg.data);
      },
    };
  });

  useImperativeHandle(ref, () => ({
    write: (f: TerminalFrame) => call({ type: "frames", frames: [{ width: f.width, height: f.height, bytes: f.bytes }] }),
    setHistoryHtml: (html: string) => call({ type: "historyHtml", html }),
    focus: () => call({ type: "focus" }),
    reset: () => call({ type: "reset" }),
    setMode: (mode: TerminalViewMode) => call({ type: "mode", mode }),
    scrollToBottom: () => call({ type: "scrollToBottom" }),
  }));
  return (
    <iframe
      ref={frame}
      srcDoc={TERMINAL_HTML}
      onLoad={onReady}
      style={{ border: 0, flex: 1, width: "100%", height: "100%", background: "#0A0A0A" }}
    />
  );
});
