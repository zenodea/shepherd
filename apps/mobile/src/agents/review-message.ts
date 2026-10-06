export type ReviewComment = { id: string; path: string; side: "new" | "old"; line: number; code: string; text: string };

/** The comments as one message for the agent: each with its file, line and code, in file order; an overall note last. */
export function reviewMessage(comments: ReviewComment[], note = ""): string {
  const sorted = [...comments].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  const parts = sorted.map((c) => {
    const where = `${c.path}:${c.line}${c.side === "old" ? " (a line you removed)" : ""}`;
    const code = c.code.trim() ? `\n> ${c.code.trim()}` : "";
    return `${where}${code}\n${c.text}`;
  });
  const intro = `Review of your changes (${comments.length} comment${comments.length === 1 ? "" : "s"}):`;
  return [intro, ...parts, ...(note.trim() ? [note.trim()] : [])].join("\n\n");
}
