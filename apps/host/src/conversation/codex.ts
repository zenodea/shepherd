// Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-<local time>-<thread id>.jsonl
// Each line is {timestamp, type, payload}. The same message shows up more than
// once (as a response_item and as a completed item), so this reads the
// completed items, plus function calls for the agent tools that only appear there.
import type { ContextUsage } from "@shepherd/protocol";
import { clip, clipOutput, contentText, isRecord, num, str, toolCall, type Draft, type Parser } from "./entries.ts";

function itemText(content: unknown): string {
  if (!Array.isArray(content)) return contentText(content);
  return content
    .map((c) => (isRecord(c) && typeof c.text === "string" ? c.text : isRecord(c) && c.type === "input_image" ? "[image]" : ""))
    .filter(Boolean)
    .join("\n");
}

function functionArguments(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function codexParser(): Parser {
  let synthetic = 0;
  let context: ContextUsage | null = null;
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
          const changes = isRecord(item.changes) ? item.changes : {};
          const paths = Object.keys(changes);
          const diff = paths
            .map((path) => {
              const change = changes[path];
              if (!isRecord(change)) return path;
              return `${path}\n${str(change.unified_diff) ?? str(change.content) ?? ""}`;
            })
            .join("\n\n");
          return [
            toolCall(id, "edit", { path: paths.join(", ") }, at),
            { kind: "tool_result", callId: id, ok: item.status !== "failed", output: clipOutput(diff), ...stamp },
          ];
        }
        case "ContextCompaction":
          return [{ kind: "notice", text: "Conversation compacted", ...stamp }];
        default:
          return [];
      }
    }

    // Agent tools (spawn_agent, wait, …) only appear as function calls.
    if (record.type === "response_item") {
      if (payload.type === "function_call") {
        return [toolCall(str(payload.call_id) ?? `codex-${++synthetic}`, str(payload.name) ?? "tool", functionArguments(payload.arguments), at)];
      }
      if (payload.type === "function_call_output") {
        const output = isRecord(payload.output) ? str(payload.output.content) ?? JSON.stringify(payload.output) : contentText(payload.output);
        return [{ kind: "tool_result", callId: str(payload.call_id) ?? "", ok: true, output: clipOutput(output), ...stamp } satisfies Draft];
      }
    }
    return [];
  };
  return Object.assign(parse, { context: () => context });
}
