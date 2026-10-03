// Turning transcript records into conversation entries: the pieces every
// harness's parser shares.
import type { ContextUsage, ConversationEntry, FileDiff, QueuedMessage } from "@shepherd/protocol";

/** An entry before the reader numbers it. */
export type Draft = ConversationEntry extends infer E ? (E extends ConversationEntry ? Omit<E, "id"> : never) : never;

/**
 * Reads one transcript line (already JSON-parsed) into entries. Parsers may
 * keep state across lines, such as the agent's message queue when its
 * transcript records one.
 */
export type Parser = ((record: Record<string, unknown>) => Draft[]) & {
  queued?: () => QueuedMessage[];
  /** How full the context is, as of the latest usage in the transcript. */
  context?: () => ContextUsage | null;
};

export function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const TEXT_LIMIT = 24_000;
const INPUT_LIMIT = 2_000;
const OUTPUT_HEAD = 3_000;
const OUTPUT_TAIL = 1_000;

export function clip(text: string, limit = TEXT_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… (${text.length - limit} more characters)`;
}

/** Tool output: the start and the end, which is where errors and summaries are. */
export function clipOutput(text: string): string {
  if (text.length <= OUTPUT_HEAD + OUTPUT_TAIL) return text;
  return `${text.slice(0, OUTPUT_HEAD)}\n… (${text.length - OUTPUT_HEAD - OUTPUT_TAIL} characters) …\n${text.slice(-OUTPUT_TAIL)}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Text out of a content field that is a string or a list of `{type:"text", text}` blocks. */
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!isRecord(block)) return "";
      if (typeof block.text === "string") return block.text;
      if (block.type === "image" || block.type === "input_image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

const SUMMARY_FIELDS = ["command", "cmd", "file_path", "path", "filePath", "pattern", "url", "query", "description", "prompt", "task", "task_name", "title", "skill", "message", "name", "agent_id", "id"];

/** One line saying what a tool call does, from its input. */
export function toolSummary(input: unknown): string {
  if (typeof input === "string") return firstLine(input);
  if (!isRecord(input)) return "";
  // Questions for the person, e.g. Claude Code's AskUserQuestion.
  if (Array.isArray(input.questions)) {
    const first = input.questions.find((q) => isRecord(q) && typeof q.question === "string") as { question: string } | undefined;
    if (first) return firstLine(first.question);
  }
  for (const field of SUMMARY_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) return firstLine(value);
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) return firstLine(value.join(" "));
  }
  return "";
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

/** The full input, when the one-line summary doesn't already say it all. */
export function toolInput(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  const text = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  if (!text || text === "{}" || text.trim() === toolSummary(input)) return undefined;
  return clip(text, INPUT_LIMIT);
}

/**
 * A tool call from structured input, with a readable summary and the full
 * input to expand, or for an edit, the diff of what it changed instead.
 */
export function toolCall(callId: string, name: string, input: unknown, at?: string, diff?: FileDiff): Draft {
  const summary = toolSummary(input);
  const detail = diff ? undefined : toolInput(input);
  return { kind: "tool", callId, name, summary, ...(detail ? { input: detail } : {}), ...(diff ? { diff } : {}), ...(at ? { at } : {}) };
}
