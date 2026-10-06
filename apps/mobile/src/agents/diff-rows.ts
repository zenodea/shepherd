import type { DiffLine, FileDiff } from "@shepherd/protocol";
import { foldContext } from "./diff-fold";

// What a diff is drawn from: its lines with light syntax colouring and the
// exact characters that changed, folds for long unchanged stretches, and where
// each hunk starts. Pure, so it can be tested and computed once per diff.

export type TokenKind = "keyword" | "string" | "number" | "comment";
export type Span = { text: string; kind: TokenKind | null; changed: boolean };

type Lang = { lineComment: string[]; blockComment: boolean };
const C_LIKE: Lang = { lineComment: ["//"], blockComment: true };
const HASH: Lang = { lineComment: ["#"], blockComment: false };
const LANGS: Record<string, Lang> = {
  ...Object.fromEntries(["ts", "tsx", "js", "jsx", "mjs", "cjs", "java", "kt", "kts", "swift", "go", "rs", "c", "h", "cc", "cpp", "hpp", "cs", "dart", "scala", "php", "css", "scss", "json", "jsonc"].map((e) => [e, C_LIKE])),
  ...Object.fromEntries(["py", "rb", "sh", "bash", "zsh", "fish", "yml", "yaml", "toml", "ini", "conf", "r", "pl", "nix", "dockerfile", "makefile", "mk"].map((e) => [e, HASH])),
  sql: { lineComment: ["--"], blockComment: true },
  lua: { lineComment: ["--"], blockComment: false },
};

/** The kind of code in a file, from its name; null for prose and the unknown, which stay plain. */
export function langOf(path: string): Lang | null {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
  return LANGS[ext] ?? null;
}

/** Words that are keywords in the common languages; one set is enough for colour. */
const KEYWORDS = new Set(
  (
    "abstract as async await break case catch class const continue def default defer del delete do elif else enum export extends false final finally fn for " +
    "from func function go if impl implements import in instanceof interface is lambda let loop match mod module mut new nil none not null of or and " +
    "override package pass private protected pub public raise readonly return self static struct super switch this throw throws trait true try type typeof " +
    "undefined unless use val var void when where while with yield None True False"
  ).split(" "),
);

const TOKEN = /("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b0x[\da-f]+\b|\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/gi;

/** Light colouring for one line: strings, numbers, keywords and a trailing comment. Lines are coloured on their own, so a comment spanning lines isn't. */
export function tokenize(text: string, lang: Lang | null): { start: number; end: number; kind: TokenKind }[] {
  if (!lang) return [];
  const out: { start: number; end: number; kind: TokenKind }[] = [];
  const trimmed = text.trimStart();
  if ((lang.blockComment && /^(?:\/\*|\*)/.test(trimmed)) || lang.lineComment.some((c) => trimmed.startsWith(c))) {
    return [{ start: text.length - trimmed.length, end: text.length, kind: "comment" }];
  }
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    const start = m.index;
    // A comment starts here (outside a string): the rest of the line is comment.
    const before = text.slice(out.at(-1)?.end ?? 0, start);
    const comment = lang.lineComment.map((c) => before.indexOf(c)).filter((i) => i >= 0);
    if (comment.length) {
      const at = (out.at(-1)?.end ?? 0) + Math.min(...comment);
      out.push({ start: at, end: text.length, kind: "comment" });
      return out;
    }
    if (m[1]) out.push({ start, end: start + m[0].length, kind: "string" });
    else if (m[2]) out.push({ start, end: start + m[0].length, kind: "number" });
    else if (m[3] && KEYWORDS.has(m[3])) out.push({ start, end: start + m[0].length, kind: "keyword" });
  }
  const rest = text.slice(out.at(-1)?.end ?? 0);
  const comment = lang.lineComment.map((c) => rest.indexOf(c)).filter((i) => i >= 0);
  if (comment.length) out.push({ start: (out.at(-1)?.end ?? 0) + Math.min(...comment), end: text.length, kind: "comment" });
  return out;
}

/**
 * Where an edited line differs from what it replaced: the stretch between
 * their common start and common end. Null when most of the line changed,
 * where marking it would only add noise.
 */
export function changedRange(before: string, after: string): { before: [number, number]; after: [number, number] } | null {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const longest = Math.max(before.length, after.length);
  if (longest === 0 || (start === 0 && end === 0)) return null;
  if (Math.max(before.length, after.length) - start - end > longest * 0.6) return null;
  return { before: [start, before.length - end], after: [start, after.length - end] };
}

/** Colour and change marks combined into runs of text that look the same. */
export function spans(text: string, tokens: ReturnType<typeof tokenize>, changed: [number, number] | null): Span[] {
  const cuts = new Set([0, text.length]);
  for (const t of tokens) cuts.add(t.start).add(t.end);
  if (changed) cuts.add(changed[0]).add(changed[1]);
  const points = [...cuts].filter((c) => c >= 0 && c <= text.length).sort((a, b) => a - b);
  const out: Span[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i]!, points[i + 1]!];
    if (from === to) continue;
    const kind = tokens.find((t) => t.start <= from && to <= t.end)?.kind ?? null;
    const isChanged = changed ? changed[0] <= from && to <= changed[1] && changed[0] < changed[1] : false;
    const last = out.at(-1);
    if (last && last.kind === kind && last.changed === isChanged) last.text += text.slice(from, to);
    else out.push({ text: text.slice(from, to), kind, changed: isChanged });
  }
  return out;
}

/** For each removed or added line that replaced another one-for-one, the stretch that changed. */
export function pairChanges(lines: DiffLine[]): Map<number, [number, number]> {
  const ranges = new Map<number, [number, number]>();
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== "del") {
      i++;
      continue;
    }
    const dels: number[] = [];
    while (i < lines.length && lines[i]!.kind === "del") dels.push(i++);
    const adds: number[] = [];
    while (i < lines.length && lines[i]!.kind === "add") adds.push(i++);
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const range = changedRange(lines[dels[k]!]!.text, lines[adds[k]!]!.text);
      if (!range) continue;
      ranges.set(dels[k]!, range.before);
      ranges.set(adds[k]!, range.after);
    }
  }
  return ranges;
}

/** Which side and number a line is commented on: its new number, or for a removed line its old one. */
export const lineRef = (line: DiffLine): { side: "new" | "old"; number: number } =>
  line.kind === "del" ? { side: "old", number: line.old ?? 0 } : { side: "new", number: line.new ?? line.old ?? 0 };
export const lineKey = (line: DiffLine) => `${lineRef(line).side}:${lineRef(line).number}`;

export type DiffRow =
  | { kind: "hunk"; key: string; line: number }
  | { kind: "line"; key: string; line: DiffLine; spans: Span[] }
  | { kind: "fold"; key: string; count: number };

/** The rows of a diff: hunk starts, coloured lines, and folds (unless `opened`) for long unchanged stretches. */
export function diffRows(diff: FileDiff, opened: ReadonlySet<string>): DiffRow[] {
  const lang = langOf(diff.path);
  const rows: DiffRow[] = [];
  diff.hunks.forEach((hunk, h) => {
    if (h > 0 || hunk.newStart > 1) rows.push({ kind: "hunk", key: `h${h}`, line: hunk.newStart || hunk.oldStart });
    const changed = pairChanges(hunk.lines);
    const indexOf = new Map(hunk.lines.map((l, i) => [l, i]));
    foldContext(hunk.lines).forEach((piece, p) => {
      const foldKey = `f${h}:${p}`;
      if (piece.kind === "fold" && !opened.has(foldKey)) {
        rows.push({ kind: "fold", key: foldKey, count: piece.lines.length });
        return;
      }
      for (const line of piece.lines) {
        const i = indexOf.get(line)!;
        rows.push({ kind: "line", key: `l${h}:${i}`, line, spans: spans(line.text, tokenize(line.text, lang), changed.get(i) ?? null) });
      }
    });
  });
  return rows;
}
