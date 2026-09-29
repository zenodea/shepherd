// JetBrains Mono (our terminal font) lacks a few glyphs agents use a lot.
// Android would fall back to another font with different widths and break
// alignment, so swap them for close lookalikes the font has.
const SWAPS: Record<string, string> = {
  "⏺": "●",
  "⎿": "└",
  "✔": "✓",
  "↵": "⏎",
  "✻": "*",
  "✢": "*",
  "✳": "*",
  "✶": "*",
  "✽": "*",
};
const PATTERN = /[⏺⎿✔↵✻✢✳✶✽⠀-⣿]/g;

export function normalizeGlyphs(text: string): string {
  return text.replace(PATTERN, (ch) => SWAPS[ch] ?? "·");
}
