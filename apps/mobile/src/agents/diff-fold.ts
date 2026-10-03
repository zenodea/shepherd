import type { DiffLine } from "@shepherd/protocol";

/** Unchanged lines kept around each change; longer stretches fold away. */
export const CONTEXT_LINES = 3;

export type DiffPiece = { kind: "lines"; lines: DiffLine[] } | { kind: "fold"; lines: DiffLine[] };

/** Split a hunk into visible lines and foldable stretches of unchanged lines. */
export function foldContext(lines: DiffLine[], context = CONTEXT_LINES): DiffPiece[] {
  const pieces: DiffPiece[] = [];
  const push = (kind: DiffPiece["kind"], chunk: DiffLine[]) => {
    if (!chunk.length) return;
    const last = pieces.at(-1);
    if (last && last.kind === kind && kind === "lines") last.lines.push(...chunk);
    else pieces.push({ kind, lines: chunk });
  };
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== "ctx") {
      const start = i;
      while (i < lines.length && lines[i]!.kind !== "ctx") i++;
      push("lines", lines.slice(start, i));
      continue;
    }
    const start = i;
    while (i < lines.length && lines[i]!.kind === "ctx") i++;
    const run = lines.slice(start, i);
    const keepBefore = start === 0 ? 0 : context; // after a change
    const keepAfter = i === lines.length ? 0 : context; // before a change
    if (run.length <= keepBefore + keepAfter + 1) {
      push("lines", run);
    } else {
      push("lines", run.slice(0, keepBefore));
      push("fold", run.slice(keepBefore, run.length - keepAfter));
      push("lines", run.slice(run.length - keepAfter));
    }
  }
  return pieces;
}
