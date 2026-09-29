import type { StyledLine, StyledSpan } from "@shepherd/protocol";

/** Something tappable in a terminal line. */
export type LineLink = { kind: "url" | "path"; value: string };

/** A range of a line's text: a link, a search match, or both. */
export type Mark = { start: number; end: number; link?: LineLink; match?: "current" | "other" };

/** A piece of a styled span, with what it's part of. */
export type Segment = { span: StyledSpan; link?: LineLink; match?: "current" | "other" };

const URL = /\bhttps?:\/\/[^\s<>"'`)\]]+/g;
// A file with an extension (src/app.ts, ./x.md, ~/a/b.json, optionally :line:col),
// or an absolute or home path with at least two parts (/Users/me/code, ~/work/api).
const PATH = /(?:^|(?<=[\s(`'"[]))((?:~|\.{1,2})?\/?(?:[\w@.+-]+\/)+[\w@+-][\w@.+-]*\.[A-Za-z0-9]{1,8}(?::\d+){0,2}|(?:~|)\/[\w@.+-]+(?:\/[\w@.+-]+)+)/g;
const TRAILING = /[.,;:!?]+$/;

export function lineText(line: StyledLine): string {
  return line.map((span) => span[0]).join("");
}

/** URLs and file paths in a line of text. */
export function findLinks(text: string): Mark[] {
  const marks: Mark[] = [];
  for (const m of text.matchAll(URL)) {
    const value = m[0].replace(TRAILING, "");
    marks.push({ start: m.index, end: m.index + value.length, link: { kind: "url", value } });
  }
  for (const m of text.matchAll(PATH)) {
    const value = m[1]!.replace(TRAILING, "");
    const start = m.index + m[0].indexOf(m[1]!);
    const end = start + value.length;
    if (value.length < 4 || marks.some((u) => start < u.end && end > u.start)) continue;
    marks.push({ start, end, link: { kind: "path", value } });
  }
  return marks.sort((a, b) => a.start - b.start);
}

/** Every case-insensitive occurrence of `query` in `text`. */
export function findMatches(text: string, query: string, current: boolean): Mark[] {
  if (!query) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const marks: Mark[] = [];
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) {
    marks.push({ start: i, end: i + needle.length, match: current ? "current" : "other" });
  }
  return marks;
}

/** Cut a line's spans at the marks' edges, tagging each piece with the marks that cover it. */
export function segment(line: StyledLine, marks: Mark[]): Segment[] {
  if (marks.length === 0) return line.map((span) => ({ span }));
  const out: Segment[] = [];
  let col = 0;
  for (const span of line) {
    const [text, fg, bg, flags] = span;
    const end = col + text.length;
    const cuts = new Set<number>([col, end]);
    for (const m of marks) {
      if (m.start > col && m.start < end) cuts.add(m.start);
      if (m.end > col && m.end < end) cuts.add(m.end);
    }
    const points = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const covering = marks.filter((m) => m.start <= a && m.end >= b);
      out.push({
        span: [text.slice(a - col, b - col), fg, bg, flags],
        link: covering.find((m) => m.link)?.link,
        match: covering.find((m) => m.match)?.match,
      });
    }
    col = end;
  }
  return out;
}
