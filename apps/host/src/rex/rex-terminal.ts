import { EventEmitter } from "node:events";
import type { HerdrTerminalCommand, TerminalMode } from "@shepherd/protocol";
import type { StreamEvents } from "../herdr/terminal-stream.ts";
import type { RexClient } from "./rex-client.ts";

const POLL_MS = 250;
/** Clear the screen and home the cursor, so every frame draws the whole screen. */
const REDRAW = "\x1b[H\x1b[2J";

/**
 * A pane's live screen from Rex, in the shape of herdr's `terminal session`
 * frames. Rex streams screens over a data connection whose format isn't
 * published, so this reads the screen a few times a second and sends it
 * again whenever it changes.
 */
export class RexTerminalStream extends EventEmitter<StreamEvents> {
  readonly mode: TerminalMode;
  private readonly rex: RexClient;
  private readonly paneId: string;
  private timer: NodeJS.Timeout | null = null;
  private last = "";
  private seq = 0;
  private closed = false;
  private failures = 0;

  constructor(rex: RexClient, opts: { paneId: string; mode: TerminalMode; cols: number; rows: number }) {
    super();
    this.rex = rex;
    this.paneId = opts.paneId;
    this.mode = opts.mode;
    // Rex applies a size only while no app owns the pane, so this can't squeeze the desktop's.
    if (opts.mode === "control") void rex.resize(opts.paneId, opts.cols, opts.rows).catch(() => {});
    setImmediate(() => void this.poll());
  }

  send(command: HerdrTerminalCommand): boolean {
    if (this.closed || this.mode !== "control") return false;
    if (command.type === "terminal.input") {
      const data = "text" in command ? command.text : Buffer.from(command.bytes, "base64").toString("utf8");
      void this.rex.input(this.paneId, data).then(() => this.soon(), (err: Error) => this.finish(err.message));
    } else if (command.type === "terminal.resize") {
      void this.rex.resize(this.paneId, command.cols, command.rows).catch(() => {});
    }
    // Scrolling and releasing have nothing to do here: every frame is the live screen.
    return true;
  }

  close(): void {
    this.finish("closed by client");
  }

  /** Look again right after typing, so what was typed shows without waiting for the next poll. */
  private soon(): void {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), 30);
  }

  private async poll(): Promise<void> {
    this.timer = null;
    if (this.closed) return;
    try {
      const screen = await this.rex.screen(this.paneId);
      this.failures = 0;
      const text = REDRAW + screen.lines.join("\r\n") + screen.cursor;
      if (!this.closed && text !== this.last) {
        this.last = text;
        this.emit("frame", {
          type: "terminal.frame",
          seq: ++this.seq,
          encoding: "ansi",
          width: screen.columns,
          height: screen.rows,
          full: true,
          bytes: Buffer.from(text).toString("base64"),
        });
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "pane_not_found" || ++this.failures >= 5) return this.finish(code === "pane_not_found" ? "exited" : (err as Error).message);
    }
    if (!this.closed && !this.timer) this.timer = setTimeout(() => void this.poll(), POLL_MS);
  }

  private finish(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.emit("closed", reason);
  }
}
