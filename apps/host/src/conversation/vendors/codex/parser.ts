// Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-<local time>-<thread id>.jsonl
// Each line is {timestamp, type, payload}. The same message shows up more than
// once (as a response_item and as a completed item), so this reads the
// completed items, plus function calls for the agent tools that only appear there.
// In code mode the agent's script (a custom "exec" call) runs tools: an image it views
// is a completed ImageView (its path) and comes back, as data, in the script's output.
import type { ContextUsage, FileDiff } from "@shepherd/protocol";
import { addedFile, parseUnifiedDiff } from "../../../changes/diff.ts";
import { clip, clipOutput, contentText, isRecord, num, str, toolCall, type Draft, type Parser } from "../../entries.ts";

function itemText(content: unknown): string {
  if (!Array.isArray(content)) return contentText(content);
  return content
    .map((c) => (isRecord(c) && typeof c.text === "string" ? c.text : isRecord(c) && c.type === "input_image" ? "[image]" : ""))
    .filter(Boolean)
    .join("\n");
}

const ENCRYPTED = /^gAAAAA[\w-]{20,}/;

function functionArguments(raw: unknown): unknown {
  let args = raw;
  if (typeof raw === "string") {
    try {
      args = JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (!isRecord(args)) return args;
  return Object.fromEntries(Object.entries(args).filter(([, v]) => !(typeof v === "string" && ENCRYPTED.test(v))));
}

const agentName = (path: unknown) => (path === "/root" ? "the main agent" : (str(path)?.split("/").pop() ?? "an agent"));

/** A message between agents; what it says is encrypted, who it's from and to isn't. */
function agentMessage(payload: Record<string, unknown>): string {
  const header = contentText(Array.isArray(payload.content) ? payload.content.filter((c) => isRecord(c) && c.type === "input_text") : "");
  const task = /Message Type: NEW_TASK/.test(header);
  return task
    ? `Task for ${agentName(payload.recipient)} from ${agentName(payload.author)}`
    : `Message from ${agentName(payload.author)} to ${agentName(payload.recipient)}`;
}

/** A file:// URL as a plain path. */
const filePath = (path: unknown) => {
  const value = str(path) ?? "";
  return value.startsWith("file://") ? decodeURIComponent(new URL(value).pathname) : value;
};

export function codexParser(): Parser {
  let synthetic = 0;
  let context: ContextUsage | null = null;
  // Images a script viewed, waiting for the script's output that carries them.
  let viewed: string[] = [];
  const parse = (record: Record<string, unknown>): Draft[] => {
    const at = str(record.timestamp);
    const stamp = at ? { at } : {};
    const payload = record.payload;
    if (!isRecord(payload)) return [];

    if (record.type === "compacted") return [{ kind: "notice", text: "Conversation compacted", ...stamp }];

    if (record.type === "event_msg") {
      // The last call's input is what's in the context; Codex records the window too.
      if (payload.type === "token_count" && isRecord(payload.info) && isRecord(payload.info.last_token_usage)) {
        const used = num(payload.info.last_token_usage.input_tokens);
        const window = num(payload.info.model_context_window) || null;
        if (used > 0) context = { used, window };
        return [];
      }
      if (payload.type === "turn_aborted") return [{ kind: "notice", text: "Interrupted", ...stamp }];
      if (payload.type !== "item_completed" || !isRecord(payload.item)) return [];
      const item = payload.item;
      const id = str(item.id) ?? `codex-${++synthetic}`;
      switch (item.type) {
        case "UserMessage": {
          const text = itemText(item.content).trim();
          return text ? [{ kind: "user", text: clip(text), ...stamp }] : [];
        }
        case "AgentMessage": {
          const text = itemText(item.content).trim();
          return text ? [{ kind: "assistant", text: clip(text), ...stamp }] : [];
        }
        case "CommandExecution": {
          const command = Array.isArray(item.command) ? item.command.map(String) : [];
          // `bash -lc "…"`: show the script, not the wrapper.
          const script = command.length >= 3 && /(^|\/)(ba|z)?sh$/.test(command[0]!) && command[1]!.startsWith("-") ? command.slice(2).join(" ") : command.join(" ");
          const output = str(item.aggregated_output) ?? [str(item.stdout), str(item.stderr)].filter(Boolean).join("\n");
          return [
            toolCall(id, "exec", { command: script }, at),
            { kind: "tool_result", callId: id, ok: item.status === "completed" && (item.exit_code === 0 || item.exit_code === undefined), output: clipOutput(output), ...stamp },
          ];
        }
        case "FileChange": {
          // One line per file, each with exactly what changed in it.
          const changes = isRecord(item.changes) ? item.changes : {};
          const ok = item.status !== "failed";
          return Object.entries(changes).flatMap(([path, change], index): Draft[] => {
            const callId = `${id}:${index}`;
            let diff: FileDiff = { path, hunks: [], additions: 0, deletions: 0 };
            if (isRecord(change)) {
              if (typeof change.unified_diff === "string") diff = parseUnifiedDiff(change.unified_diff, path)[0] ?? diff;
              else if (typeof change.content === "string") diff = change.type === "delete" ? { ...diff, deletions: change.content.split("\n").length } : addedFile(path, change.content);
            }
            const verb = isRecord(change) && change.type === "add" ? "add" : isRecord(change) && change.type === "delete" ? "delete" : "edit";
            return [
              toolCall(callId, verb, { path }, at, { ...diff, path }),
              { kind: "tool_result", callId, ok, output: "", ...stamp },
            ];
          });
        }
        case "ImageView":
          viewed.push(id);
          return [toolCall(id, "view_image", { path: filePath(item.path) }, at)];
        case "ContextCompaction":
          return [{ kind: "notice", text: "Conversation compacted", ...stamp }];
        default:
          return [];
      }
    }

    // Agent tools (spawn_agent, wait, …) only appear as function calls.
    if (record.type === "response_item") {
      if (payload.type === "agent_message") return [{ kind: "notice", text: agentMessage(payload), ...stamp }];
      if (payload.type === "function_call") {
        return [toolCall(str(payload.call_id) ?? `codex-${++synthetic}`, str(payload.name) ?? "tool", functionArguments(payload.arguments), at)];
      }
      if (payload.type === "function_call_output") {
        const output = isRecord(payload.output) ? str(payload.output.content) ?? JSON.stringify(payload.output) : contentText(payload.output);
        return [{ kind: "tool_result", callId: str(payload.call_id) ?? "", ok: true, output: clipOutput(output), ...stamp } satisfies Draft];
      }
      // A script's output: the results of the images it viewed, the first carrying them (its own commands show as
      // completed items).
      if (payload.type === "custom_tool_call_output" && viewed.length) {
        const results = viewed.map((callId): Draft => ({ kind: "tool_result", callId, ok: true, output: "", ...stamp }));
        viewed = [];
        return results;
      }
    }
    return [];
  };
  return Object.assign(parse, { context: () => context });
}
