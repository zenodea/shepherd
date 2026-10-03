// pi: ~/.pi/agent/sessions/--<cwd, "/" as "-">--/<time>_<id>.jsonl
// A header line, then {type, id, parentId, timestamp} entries; each message
// record holds a whole message.
import type { ContextUsage } from "@shepherd/protocol";
import type { FileDiff } from "@shepherd/protocol";
import { addedFile, editsDiff } from "../../../changes/diff.ts";
import { clip, clipOutput, contentText, isRecord, num, str, toolCall, type Draft, type Parser } from "../../entries.ts";

/** What pi's edit or write call changed, from its own arguments. */
function editDiff(name: string, args: unknown): FileDiff | undefined {
  if (!isRecord(args) || typeof args.path !== "string") return undefined;
  if (name === "edit" && Array.isArray(args.edits)) {
    return editsDiff(args.path, args.edits.filter(isRecord).map((e) => ({ before: str(e.oldText) ?? "", after: str(e.newText) ?? "" })));
  }
  if (name === "write" && typeof args.content === "string") return addedFile(args.path, args.content);
  return undefined;
}

export function piSessionDir(cwd: string): string {
  return `--${cwd.replace(/^\//, "").replace(/\//g, "-")}--`;
}

export function piParser(): Parser {
  let context: ContextUsage | null = null;
  const parse = (record: Record<string, unknown>): Draft[] => {
    const at = str(record.timestamp);
    const stamp = at ? { at } : {};
    if (record.type === "compaction") return [{ kind: "notice", text: "Conversation compacted", ...stamp }];
    if (record.type !== "message" || !isRecord(record.message)) return [];
    const message = record.message;

    if (message.role === "user") {
      const text = contentText(message.content).trim();
      return text ? [{ kind: "user", text: clip(text), ...stamp }] : [];
    }
    if (message.role === "toolResult") {
      return [{ kind: "tool_result", callId: str(message.toolCallId) ?? "", ok: message.isError !== true, output: clipOutput(contentText(message.content)), ...stamp }];
    }
    if (message.role === "assistant" && isRecord(message.usage)) {
      const u = message.usage;
      const used = num(u.input) + num(u.cacheRead) + num(u.cacheWrite);
      if (used > 0) context = { used, window: null };
    }
    if (message.role === "assistant" && Array.isArray(message.content)) {
      const out: Draft[] = [];
      for (const block of message.content) {
        if (!isRecord(block)) continue;
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) out.push({ kind: "assistant", text: clip(block.text.trim()), ...stamp });
        else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) out.push({ kind: "thinking", text: clip(block.thinking.trim()), ...stamp });
        else if (block.type === "toolCall") {
          const name = str(block.name) ?? "tool";
          out.push(toolCall(str(block.id) ?? "", name, block.arguments, at, editDiff(name, block.arguments)));
        }
      }
      return out;
    }
    return [];
  };
  return Object.assign(parse, { context: () => context });
}
