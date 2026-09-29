// Terminal colours, shared so the host (which renders screens into styled
// lines) and the app (which parses ANSI history) draw them identically.

export const BASIC_COLORS = ["#3F3F46", "#F87171", "#4ADE80", "#FACC15", "#60A5FA", "#C084FC", "#22D3EE", "#E5E5E5"];
export const BRIGHT_COLORS = ["#71717A", "#FCA5A5", "#86EFAC", "#FDE047", "#93C5FD", "#D8B4FE", "#67E8F9", "#FAFAFA"];

export function color256(n: number): string {
  if (n < 8) return BASIC_COLORS[n]!;
  if (n < 16) return BRIGHT_COLORS[n - 8]!;
  if (n < 232) {
    const i = n - 16;
    const level = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return `rgb(${level(Math.floor(i / 36))},${level(Math.floor(i / 6) % 6)},${level(i % 6)})`;
  }
  const gray = 8 + (n - 232) * 10;
  return `rgb(${gray},${gray},${gray})`;
}

export function rgbColor(packed: number): string {
  return `rgb(${(packed >> 16) & 255},${(packed >> 8) & 255},${packed & 255})`;
}

/** Style flags on a styled span. */
export const SPAN_BOLD = 1;
export const SPAN_DIM = 2;
export const SPAN_ITALIC = 4;
export const SPAN_UNDERLINE = 8;

/** [text, foreground, background, flags]; null colours mean the default. */
export type StyledSpan = [text: string, fg: string | null, bg: string | null, flags: number];
export type StyledLine = StyledSpan[];
