// Diffs as the app draws them: hunks of added, removed and unchanged lines.
import type { DiffHunk, DiffLine, FileDiff } from "@shepherd/protocol";

/** Beyond this many lines a diff is cut short (and says so). */
export const MAX_DIFF_LINES = 3000;
/** Line-diffing an edit is quadratic; past this, show it as removed-then-added. */
const MAX_LCS_LINES = 600;

function finish(path: string, hunks: DiffHunk[], extra: Partial<FileDiff> = {}): FileDiff {
  let additions = 0;
  let deletions = 0;
  let budget = MAX_DIFF_LINES;
  let truncated = false;
  const kept: DiffHunk[] = [];
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") additions++;
      if (line.kind === "del") deletions++;
    }
    if (budget <= 0) {
      truncated = true;
      continue;
    }
    const lines = hunk.lines.slice(0, budget);
    if (lines.length < hunk.lines.length) truncated = true;
    budget -= lines.length;
    kept.push({ ...hunk, lines });
  }
  return { path, hunks: kept, additions, deletions, ...(truncated ? { truncated } : {}), ...extra };
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parse unified diff text: git's output for one or more files, or just
 * hunks (as Codex records them). Files without a header get `fallbackPath`.
 */
export function parseUnifiedDiff(text: string, fallbackPath = ""): FileDiff[] {
  const files: FileDiff[] = [];
  let path = fallbackPath;
  let hunks: DiffHunk[] = [];
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let binary = false;
  let started = false;
  const flush = () => {
    if (started) files.push(finish(path, hunks, binary ? { binary } : {}));
    hunks = [];
    hunk = null;
    binary = false;
    started = false;
  };
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      flush();
      started = true;
      path = / b\/(.*)$/.exec(raw)?.[1] ?? fallbackPath;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      started = true;
      if (raw !== "+++ /dev/null") path = raw.slice(4).replace(/^b\//, "");
      continue;
    }
    if (raw.startsWith("--- ") && !hunk) continue;
    if (raw.startsWith("Binary files ")) {
      started = true;
      binary = true;
      continue;
    }
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      started = true;
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunk = { oldStart: oldLine, newStart: newLine, lines: [] };
      hunks.push(hunk);
      continue;
    }
    if (!hunk || raw.startsWith("\\")) continue;
    const current: DiffHunk = hunk;
    if (raw.startsWith("+")) current.lines.push({ kind: "add", text: raw.slice(1), new: newLine++ });
    else if (raw.startsWith("-")) current.lines.push({ kind: "del", text: raw.slice(1), old: oldLine++ });
    else if (raw.startsWith(" ") || raw === "") current.lines.push({ kind: "ctx", text: raw.slice(1), old: oldLine++, new: newLine++ });
  }
  flush();
  // A trailing empty line from the final newline isn't a real context line.
  for (const file of files) {
    const last = file.hunks.at(-1)?.lines;
    if (last?.length && last.at(-1)!.kind === "ctx" && last.at(-1)!.text === "") last.pop();
  }
  return files;
}

function lines(text: string): string[] {
  const out = text.split("\n");
  if (out.length > 1 && out.at(-1) === "") out.pop();
  return out;
}

/** The line-by-line difference between two snippets, as one hunk. */
export function lineDiff(path: string, before: string, after: string): FileDiff {
  return finish(path, [editHunk(before, after)]);
}

/** Several replacements in one file (one hunk each). */
export function editsDiff(path: string, edits: { before: string; after: string }[]): FileDiff {
  return finish(path, edits.map((e) => editHunk(e.before, e.after)));
}

function editHunk(before: string, after: string): DiffHunk {
  const a = before ? lines(before) : [];
  const b = after ? lines(after) : [];
  const out: DiffLine[] = [];
  if (a.length > MAX_LCS_LINES || b.length > MAX_LCS_LINES) {
    a.forEach((text) => out.push({ kind: "del", text }));
    b.forEach((text) => out.push({ kind: "add", text }));
    return { oldStart: 1, newStart: 1, lines: out };
  }
  // Longest common subsequence, then walk it.
  const n = a.length;
  const m = b.length;
  const table: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: "ctx", text: a[i]! });
      i++;
      j++;
    } else if (j < m && (i === n || table[i]![j + 1]! >= table[i + 1]![j]!)) {
      out.push({ kind: "add", text: b[j++]! });
    } else {
      out.push({ kind: "del", text: a[i++]! });
    }
  }
  // Removals before additions within each changed stretch reads better.
  for (let k = 0; k < out.length; ) {
    if (out[k]!.kind === "ctx") {
      k++;
      continue;
    }
    let end = k;
    while (end < out.length && out[end]!.kind !== "ctx") end++;
    const stretch = out.slice(k, end);
    out.splice(k, end - k, ...stretch.filter((l) => l.kind === "del"), ...stretch.filter((l) => l.kind === "add"));
    k = end;
  }
  return { oldStart: 1, newStart: 1, lines: out };
}

/** A whole new file. */
export function addedFile(path: string, content: string): FileDiff {
  const added = lines(content).map((text, i): DiffLine => ({ kind: "add", text, new: i + 1 }));
  return finish(path, added.length ? [{ oldStart: 0, newStart: 1, lines: added }] : []);
}
