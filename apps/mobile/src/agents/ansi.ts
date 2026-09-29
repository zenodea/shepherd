// Minimal ANSI → styled spans for the history view: SGR colours and weights;
// every other escape sequence is dropped.
import { BASIC_COLORS as BASIC, BRIGHT_COLORS as BRIGHT, SPAN_BOLD, SPAN_DIM, SPAN_ITALIC, SPAN_UNDERLINE, color256, type StyledLine } from "@sheperd/protocol";

export type Span = {
  text: string;
  color?: string;
  background?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
};

type Style = Omit<Span, "text">;

function applySgr(params: number[], style: Style): Style {
  const next = { ...style };
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    if (p === 0) {
      for (const key of Object.keys(next)) delete next[key as keyof Style];
    } else if (p === 1) next.bold = true;
    else if (p === 2) next.dim = true;
    else if (p === 3) next.italic = true;
    else if (p === 4) next.underline = true;
    else if (p === 22) {
      delete next.bold;
      delete next.dim;
    } else if (p === 23) delete next.italic;
    else if (p === 24) delete next.underline;
    else if (p >= 30 && p <= 37) next.color = BASIC[p - 30];
    else if (p >= 90 && p <= 97) next.color = BRIGHT[p - 90];
    else if (p === 39) delete next.color;
    else if (p >= 40 && p <= 47) next.background = BASIC[p - 40];
    else if (p >= 100 && p <= 107) next.background = BRIGHT[p - 100];
    else if (p === 49) delete next.background;
    else if (p === 38 || p === 48) {
      const key = p === 38 ? "color" : "background";
      if (params[i + 1] === 5 && params[i + 2] !== undefined) {
        next[key] = color256(params[i + 2]!);
        i += 2;
      } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
        next[key] = `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`;
        i += 4;
      }
    }
  }
  return next;
}

// CSI … final byte, OSC … BEL/ST, and other two-byte escapes.
const ESCAPE = /\u001b\[([0-9;:?]*)([@-~])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** Split text into lines of styled spans. Style carries across lines. */
export function parseAnsi(text: string): Span[][] {
  const lines: Span[][] = [];
  let style: Style = {};
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const spans: Span[] = [];
    let last = 0;
    for (const match of raw.matchAll(ESCAPE)) {
      if (match.index! > last) spans.push({ text: raw.slice(last, match.index), ...style });
      if (match[2] === "m") {
        const params = (match[1] || "0").split(/[;:]/).map((n) => Number(n) || 0);
        style = applySgr(params, style);
      }
      last = match.index! + match[0].length;
    }
    if (last < raw.length) spans.push({ text: raw.slice(last), ...style });
    lines.push(spans.filter((s) => s.text.length > 0));
  }
  // Drop trailing blank lines (the empty rows below a prompt).
  while (lines.length > 0 && lines[lines.length - 1]!.every((s) => s.text.trim() === "")) lines.pop();
  return lines;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Render parsed lines as HTML (one <div> per line) for the terminal page. */
export function linesToHtml(lines: Span[][]): string {
  return lines
    .map((spans) => {
      if (spans.length === 0) return "<div> </div>";
      const inner = spans
        .map((s) => {
          const css = [
            s.color ? `color:${s.color}` : "",
            s.background ? `background:${s.background}` : "",
            s.bold ? "font-weight:700" : "",
            s.dim ? "opacity:.6" : "",
            s.italic ? "font-style:italic" : "",
            s.underline ? "text-decoration:underline" : "",
          ]
            .filter(Boolean)
            .join(";");
          return css ? `<span style="${css}">${escapeHtml(s.text)}</span>` : escapeHtml(s.text);
        })
        .join("");
      return `<div>${inner}</div>`;
    })
    .join("");
}

/** Parsed lines in the compact form the host sends for live screens. */
export function toStyledLines(lines: Span[][]): StyledLine[] {
  return lines.map((spans) =>
    spans.map((s) => [
      s.text,
      s.color ?? null,
      s.background ?? null,
      (s.bold ? SPAN_BOLD : 0) | (s.dim ? SPAN_DIM : 0) | (s.italic ? SPAN_ITALIC : 0) | (s.underline ? SPAN_UNDERLINE : 0),
    ]),
  );
}
