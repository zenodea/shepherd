import { withImages } from "../agents/attachment-message";

export type Shared = { text?: string | null; subject?: string | null };

/** What was shared as text: the subject (often a page's title) over the text (its link), unless the text already says it. */
export function sharedText({ text, subject }: Shared): string {
  const body = text?.trim() ?? "";
  const title = subject?.trim() ?? "";
  if (title && body && !body.includes(title)) return `${title}\n${body}`;
  return body || title;
}

/** The message for the agent: your note, then what was shared, then the images' paths on the computer. */
export function shareMessage(note: string, shared: Shared, imagePaths: string[]): string {
  const text = [note.trim(), sharedText(shared)].filter(Boolean).join("\n\n");
  return withImages(text, imagePaths.map((path) => ({ id: path, uri: "", state: "ready" as const, path })));
}
