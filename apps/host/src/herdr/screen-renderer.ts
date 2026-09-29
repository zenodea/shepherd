import xterm from "@xterm/headless";
import {
  BASIC_COLORS,
  BRIGHT_COLORS,
  SPAN_BOLD,
  SPAN_DIM,
  SPAN_ITALIC,
  SPAN_UNDERLINE,
  color256,
  rgbColor,
  type StyledLine,
  type StyledSpan,
} from "@shepherd/protocol";

const { Terminal } = xterm;
type HeadlessTerminal = InstanceType<typeof Terminal>;
type Cell = NonNullable<ReturnType<NonNullable<ReturnType<HeadlessTerminal["buffer"]["active"]["getLine"]>>["getCell"]>>;

export type ScreenUpdate = {
  width: number;
  height: number;
  cursor: { x: number; y: number; visible: boolean };
  /** Row index → styled line, for rows that changed (all rows when `full`). */
  lines: Record<string, StyledLine>;
  full: boolean;
};

/** At most one update per this many ms; typing still feels immediate. */
const FLUSH_MS = 50;

function paletteColor(n: number): string {
  if (n < 8) return BASIC_COLORS[n]!;
  if (n < 16) return BRIGHT_COLORS[n - 8]!;
  return color256(n);
}

function fg(cell: Cell): string | null {
  if (cell.isFgDefault()) return null;
  return cell.isFgRGB() ? rgbColor(cell.getFgColor()) : paletteColor(cell.getFgColor());
}

function bg(cell: Cell): string | null {
  if (cell.isBgDefault()) return null;
  return cell.isBgRGB() ? rgbColor(cell.getBgColor()) : paletteColor(cell.getBgColor());
}

/** One screen row as styled spans, with trailing blank cells dropped. */
export function rowToSpans(term: HeadlessTerminal, y: number): StyledLine {
  const line = term.buffer.active.getLine(term.buffer.active.viewportY + y);
  if (!line) return [];
  const spans: StyledSpan[] = [];
  let cell: Cell | undefined;
  for (let x = 0; x < term.cols; x++) {
    cell = line.getCell(x, cell);
    if (!cell || cell.getWidth() === 0) continue; // second half of a wide character
    let f = fg(cell);
    let b = bg(cell);
    if (cell.isInverse()) [f, b] = [b ?? "#0A0A0A", f ?? "#E5E5E5"];
    const flags =
      (cell.isBold() ? SPAN_BOLD : 0) | (cell.isDim() ? SPAN_DIM : 0) | (cell.isItalic() ? SPAN_ITALIC : 0) | (cell.isUnderline() ? SPAN_UNDERLINE : 0);
    const chars = cell.getChars() || " ";
    const last = spans[spans.length - 1];
    if (last && last[1] === f && last[2] === b && last[3] === flags) last[0] += chars;
    else spans.push([chars, f, b, flags]);
  }
  // Trim trailing unstyled whitespace so rows stay small on the wire.
  while (spans.length > 0) {
    const last = spans[spans.length - 1]!;
    if (last[2] !== null) break;
    const trimmed = last[0].replace(/\s+$/, "");
    if (trimmed.length > 0) {
      last[0] = trimmed;
      break;
    }
    spans.pop();
  }
  return spans;
}

/**
 * Runs a headless terminal over herdr's frames and reports the screen as
 * styled lines, sending only rows that changed. Native views on the phone
 * render these instead of running a terminal emulator in a WebView.
 */
export class ScreenRenderer {
  private readonly term: HeadlessTerminal;
  private readonly onUpdate: (update: ScreenUpdate) => void;
  private sent: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private forceFull = true;
  private disposed = false;

  constructor(cols: number, rows: number, onUpdate: (update: ScreenUpdate) => void) {
    this.term = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
    this.onUpdate = onUpdate;
  }

  write(bytes: Uint8Array, size?: { width: number; height: number }): void {
    if (this.disposed) return;
    if (size && (size.width !== this.term.cols || size.height !== this.term.rows)) {
      this.term.resize(size.width, size.height);
      this.forceFull = true;
    }
    this.term.write(bytes, () => this.schedule());
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.term.dispose();
  }

  private schedule(): void {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, FLUSH_MS);
  }

  flush(): void {
    if (this.disposed) return;
    const full = this.forceFull;
    this.forceFull = false;
    const lines: Record<string, StyledLine> = {};
    let changed = full;
    for (let y = 0; y < this.term.rows; y++) {
      const spans = rowToSpans(this.term, y);
      const key = JSON.stringify(spans);
      if (full || key !== this.sent[y]) {
        lines[y] = spans;
        this.sent[y] = key;
        changed = true;
      }
    }
    this.sent.length = this.term.rows;
    const buffer = this.term.buffer.active;
    // DECTCEM (cursor visibility) isn't in the public API; agents hide it anyway.
    const cursorHidden = (this.term as unknown as { _core?: { coreService?: { isCursorHidden?: boolean } } })._core?.coreService?.isCursorHidden;
    if (!changed) return;
    this.onUpdate({
      width: this.term.cols,
      height: this.term.rows,
      cursor: { x: buffer.cursorX, y: buffer.cursorY, visible: !cursorHidden },
      lines,
      full,
    });
  }
}
