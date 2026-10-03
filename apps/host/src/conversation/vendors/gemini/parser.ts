// Gemini CLI: <home>/tmp/<project>/chats/session-<time>-<id>.jsonl
// A metadata line, then message records. A message is written again (same
// `id`) as it gains tool calls and token counts; `$set`, `$rewindTo` and
// `$patch` lines change the file's history and aren't followed here.
import type { ContextUsage, FileDiff } from "@shepherd/protocol";
import { addedFile, parseUnifiedDiff } from "../../../changes/diff.ts";
import { clip, clipOutput, isRecord, num, str, toolCall, type Draft, type Parser } from "../../entries.ts";

/** Gemini's own context limit per model family; the transcript doesn't record it. */
const contextWindow = (model: string | undefined) => (model && /gemma/i.test(model) ? 256_000 : 1_048_576);

const REFERENCED_FILES = /\n?--- Content from referenced files ---[\s\S]*?--- End of content ---\n?/g;

function partsText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p) => (isRecord(p) && typeof p.text === "string" && p.thought !== true ? p.text : isRecord(p) && isRecord(p.inlineData) ? "[image]" : ""))
    .filter(Boolean)
    .join("\n");
}

const isToolResponse = (content: unknown) => Array.isArray(content) && content.length > 0 && content.every((p) => isRecord(p) && isRecord(p.functionResponse));

function resultText(call: Record<string, unknown>): string {
  if (typeof call.resultDisplay === "string") return call.resultDisplay;
  const parts = Array.isArray(call.result) ? call.result : [];
  return parts
    .map((p) => (isRecord(p) && isRecord(p.functionResponse) && isRecord(p.functionResponse.response) ? (str(p.functionResponse.response.output) ?? JSON.stringify(p.functionResponse.response)) : ""))
    .filter(Boolean)
    .join("\n");
}

function editDiff(call: Record<string, unknown>): FileDiff | undefined {
  const display = call.resultDisplay;
  if (!isRecord(display)) return undefined;
  const path = str(display.filePath) ?? str(display.fileName) ?? "";
  if (typeof display.fileDiff === "string") {
    const diff = parseUnifiedDiff(display.fileDiff, path)[0];
    if (diff) return { ...diff, path };
  }
  if (display.isNewFile === true && typeof display.newContent === "string") return addedFile(path, display.newContent);
  return undefined;
}

const FINISHED = new Set(["success", "error", "cancelled"]);

export function geminiParser(): Parser {
  const shown = new Set<string>();
  const calls = new Set<string>();
  let context: ContextUsage | null = null;

  const parse = (record: Record<string, unknown>): Draft[] => {
    const id = str(record.id);
    const type = str(record.type);
    if (!id || !type) return [];
    const at = str(record.timestamp);
    const stamp = at ? { at } : {};
    const first = !shown.has(id);
    shown.add(id);
    const out: Draft[] = [];

    if (type === "user") {
      if (!first || isToolResponse(record.content)) return [];
      const text = (str(record.displayContent) ?? partsText(record.displayContent ?? record.content)).replace(REFERENCED_FILES, "").trim();
      return text ? [{ kind: "user", text: clip(text), ...stamp }] : [];
    }
    if (type === "error" || type === "warning") return first ? [{ kind: "notice", text: clip(partsText(record.content)), ...stamp }] : [];
    if (type !== "gemini") return [];

    if (isRecord(record.tokens) && num(record.tokens.input) > 0) context = { used: num(record.tokens.input), window: contextWindow(str(record.model)) };
    if (first) {
      const thoughts = Array.isArray(record.thoughts) ? record.thoughts.filter(isRecord) : [];
      const thinking = thoughts.map((t) => [str(t.subject), str(t.description)].filter(Boolean).join(": ")).join("\n\n");
      if (thinking) out.push({ kind: "thinking", text: clip(thinking), ...stamp });
      const text = partsText(record.content).trim();
      if (text) out.push({ kind: "assistant", text: clip(text), ...stamp });
    }
    for (const call of Array.isArray(record.toolCalls) ? record.toolCalls.filter(isRecord) : []) {
      const callId = str(call.id);
      if (!callId || calls.has(callId) || !FINISHED.has(str(call.status) ?? "")) continue;
      calls.add(callId);
      const callAt = str(call.timestamp) ?? at;
      out.push(toolCall(callId, str(call.displayName) ?? str(call.name) ?? "tool", call.args, callAt, editDiff(call)));
      out.push({ kind: "tool_result", callId, ok: call.status === "success", output: clipOutput(resultText(call)), ...(callAt ? { at: callAt } : {}) });
    }
    return out;
  };
  return Object.assign(parse, { context: () => context });
}
