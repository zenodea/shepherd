export type Attachment = { id: string; uri: string; state: "uploading" | "ready" | "failed"; path?: string; error?: string };

/** The message, with the images' paths on your computer after it, for the agent to open. */
export function withImages(text: string, attachments: Attachment[]): string {
  const paths = attachments.flatMap((a) => (a.state === "ready" && a.path ? [a.path] : []));
  if (!paths.length) return text;
  const list = paths.map((p) => `[Image: ${p}]`).join("\n");
  return text ? `${text}\n\n${list}` : `Have a look at ${paths.length === 1 ? "this image" : "these images"}:\n${list}`;
}
