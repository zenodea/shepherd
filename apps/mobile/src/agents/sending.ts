import type { ConversationEntry, QueuedMessage } from "@shepherd/protocol";

/** A message you just sent, shown before the agent's transcript has it. `after`: the newest entry id when you sent it. */
export type Sending = { id: string; text: string; after: number };

const MATCH_CHARS = 40;
const normal = (text: string) => text.replace(/\s+/g, " ").trim();

function same(a: string, b: string): boolean {
  const x = normal(a);
  const y = normal(b);
  return x.startsWith(y.slice(0, MATCH_CHARS)) || y.startsWith(x.slice(0, MATCH_CHARS));
}

/** The ones not in the conversation or the agent's queue yet. */
export function stillSending(sending: Sending[], entries: ConversationEntry[], queued: QueuedMessage[]): Sending[] {
  return sending.filter(
    (s) => !entries.some((e) => e.kind === "user" && e.id > s.after && same(e.text, s.text)) && !queued.some((q) => same(q.text, s.text)),
  );
}
