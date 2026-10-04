// Claude Code: ~/.claude/projects/<cwd with every non-alphanumeric as "-">/<session id>.jsonl
// One record per line. Assistant messages are split into one record per
// content block; tool results come back as user records.
import type { ContextUsage, QueuedMessage } from "@shepherd/protocol";
import type { FileDiff } from "@shepherd/protocol";
import { addedFile, editsDiff, lineDiff } from "../../../changes/diff.ts";
import { clip, clipOutput, contentText, isRecord, num, str, toolCall, type Draft, type Parser } from "../../entries.ts";

/** What an Edit, MultiEdit or Write call changed, from its own input. */
function editDiff(name: string, input: unknown): FileDiff | undefined {
  if (!isRecord(input) || typeof input.file_path !== "string") return undefined;
  const path = input.file_path;
  if (name === "Edit" && typeof input.old_string === "string" && typeof input.new_string === "string") return lineDiff(path, input.old_string, input.new_string);
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    return editsDiff(path, input.edits.filter(isRecord).map((e) => ({ before: str(e.old_string) ?? "", after: str(e.new_string) ?? "" })));
  }
  if (name === "Write" && typeof input.content === "string") return addedFile(path, input.content);
  return undefined;
}

/** Housekeeping Claude Code writes into user messages, not something the person typed. */
const HIDDEN_USER_TEXT = /^\s*<(local-command-stdout|local-command-stderr|local-command-caveat|task-notification|system-reminder)>/;

const MENU_COMMANDS = new Set(["/model", "/effort"]);

export function claudeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

function userText(text: string): string | null {
  if (HIDDEN_USER_TEXT.test(text)) return null;
  // A slash command, e.g. /clear or /compact: show it the way it was typed.
  const command = /<command-name>([^<]*)<\/command-name>/.exec(text);
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
    // Opening a menu, e.g. when Shepherd reads or switches the model: nothing was said.
    if (!args && MENU_COMMANDS.has(command[1]!.trim())) return null;
    return [command[1]!.trim(), args].filter(Boolean).join(" ");
  }
  return text.trim() || null;
}

/** `subagent`: read a subagent's own transcript, whose records are all marked as a sidechain. */
export function claudeParser({ subagent = false } = {}): Parser {
  // Claude Code records its queue of messages sent while it works: `enqueue`
  // adds one, `dequeue` starts a turn with the oldest, `remove` drops one it
  // took in mid-turn. Replaying them gives the queue as Claude has it.
  // Housekeeping Claude queues for itself stays in the replay (a later
  // `dequeue` takes it off the front) but isn't shown.
  const queue: { content: string; shown: QueuedMessage | null }[] = [];
  let context: ContextUsage | null = null;
  const parse = (record: Record<string, unknown>): Draft[] => {
    const at = str(record.timestamp);
    const stamp = at ? { at } : {};
    if (record.type === "queue-operation") {
      const content = str(record.content);
      if (record.operation === "enqueue" && content !== undefined) {
        const text = userText(content);
        queue.push({ content, shown: text ? { text: clip(text, 2_000), ...stamp } : null });
      } else if (record.operation === "dequeue") {
        queue.shift();
      } else if (record.operation === "remove" && content !== undefined) {
        const index = queue.findIndex((q) => q.content === content);
        if (index !== -1) queue.splice(index, 1);
      }
      return [];
    }
    if (record.isSidechain === true && !subagent) return [];

    if (record.type === "system") {
      return record.subtype === "compact_boundary" ? [{ kind: "notice", text: "Conversation compacted", ...stamp }] : [];
    }

    // A message you sent while it worked and it took in mid-turn: Claude records
    // it only here (the queue says `remove`), not as a user record.
    if (record.type === "attachment") {
      const attached = record.attachment;
      if (!isRecord(attached) || attached.type !== "queued_command" || !isRecord(attached.origin) || attached.origin.kind !== "human") return [];
      const prompt = Array.isArray(attached.prompt)
        ? attached.prompt
            .map((b) => (isRecord(b) && typeof b.text === "string" ? b.text : isRecord(b) && b.type === "image" ? "[image]" : ""))
            .filter(Boolean)
            .join("\n")
        : (str(attached.prompt) ?? "");
      const text = userText(prompt);
      return text ? [{ kind: "user", text: clip(text), ...stamp }] : [];
    }

    const message = record.message;
    if (!isRecord(message)) return [];

    if (record.type === "user") {
      if (record.isMeta === true || record.isCompactSummary === true) return [];
      if (typeof message.content === "string") {
        const text = userText(message.content);
        return text ? [{ kind: "user", text: clip(text), ...stamp }] : [];
      }
      if (!Array.isArray(message.content)) return [];
      const out: Draft[] = [];
      const typed: string[] = [];
      for (const block of message.content) {
        if (!isRecord(block)) continue;
        if (block.type === "tool_result") {
          out.push({
            kind: "tool_result",
            callId: str(block.tool_use_id) ?? "",
            ok: block.is_error !== true,
            output: clipOutput(contentText(block.content)),
            ...stamp,
          });
        } else if (block.type === "text" && typeof block.text === "string") {
          const text = userText(block.text);
          if (text) typed.push(text);
        } else if (block.type === "image") {
          typed.push("[image]");
        }
      }
      if (typed.length) out.unshift({ kind: "user", text: clip(typed.join("\n")), ...stamp });
      return out;
    }

    if (record.type === "assistant") {
      // Everything sent to the model for this reply: new, cache-written and cache-read input.
      if (isRecord(message.usage)) {
        const u = message.usage;
        const used = num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens);
        if (used > 0) context = { used, window: null };
      }
      if (!Array.isArray(message.content)) return [];
      const out: Draft[] = [];
      for (const block of message.content) {
        if (!isRecord(block)) continue;
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          out.push({ kind: "assistant", text: clip(block.text.trim()), ...stamp });
        } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
          out.push({ kind: "thinking", text: clip(block.thinking.trim()), ...stamp });
        } else if (block.type === "tool_use") {
          const name = str(block.name) ?? "tool";
          out.push(toolCall(str(block.id) ?? "", name, block.input, at, editDiff(name, block.input)));
        }
      }
      return out;
    }
    return [];
  };
  return Object.assign(parse, { queued: () => queue.flatMap((q) => (q.shown ? [q.shown] : [])), context: () => context });
}
