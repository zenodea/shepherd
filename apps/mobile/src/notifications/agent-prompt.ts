import { extractPrompt, type PaneReadResult } from "@shepherd/protocol";
import type { HostConnection } from "../connection/host-client";

/** A stable notification id per pane: its alert, and one below it for the outcome of a button. */
export function notificationId(paneId: string): number {
  let hash = 7;
  for (const ch of paneId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return (Math.abs(hash) % 1_000_000) * 2 + 2;
}

export async function readPrompt(client: HostConnection, paneId: string) {
  const { read } = await client.call<{ read: PaneReadResult }>("agent.read", { target: paneId, source: "visible", format: "text" });
  return extractPrompt(read.text);
}

/**
 * The question an agent just asked. It may still be drawing its answers, so
 * read again if there are none yet; the round trip is the wait (a JS timer
 * wouldn't fire while the app is in the background).
 */
export async function settledPrompt(client: HostConnection, paneId: string) {
  const first = await readPrompt(client, paneId);
  return first.options.length > 0 ? first : readPrompt(client, paneId);
}
