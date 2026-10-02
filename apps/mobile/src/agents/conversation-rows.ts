import type { ConversationEntry } from "@shepherd/protocol";

type Tool = Extract<ConversationEntry, { kind: "tool" }>;
type ToolResult = Extract<ConversationEntry, { kind: "tool_result" }>;

/** What the list shows: tool calls carry their result, and results shown that way aren't repeated. */
export type Row =
  | {
      key: string;
      kind: "message";
      entry: Exclude<ConversationEntry, Tool | ToolResult>;
    }
  | { key: string; kind: "tool"; call: Tool; result: ToolResult | null }
  | { key: string; kind: "orphan_result"; result: ToolResult };

export function conversationRows(entries: ConversationEntry[]): Row[] {
  const results = new Map<string, ToolResult>();
  const calls = new Set<string>();
  for (const e of entries) {
    if (e.kind === "tool_result") results.set(e.callId, e);
    if (e.kind === "tool") calls.add(e.callId);
  }
  const rows: Row[] = [];
  for (const e of entries) {
    if (e.kind === "tool")
      rows.push({
        key: `t${e.id}`,
        kind: "tool",
        call: e,
        result: results.get(e.callId) ?? null,
      });
    else if (e.kind === "tool_result") {
      if (!calls.has(e.callId)) rows.push({ key: `r${e.id}`, kind: "orphan_result", result: e });
    } else rows.push({ key: `m${e.id}`, kind: "message", entry: e });
  }
  return rows;
}

type Block = { code: false; text: string } | { code: true; text: string; lang: string };

/** Split markdown into prose and fenced code blocks. */
export function markdownBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let prose: string[] = [];
  let code: { lang: string; lines: string[] } | null = null;
  const flushProse = () => {
    const joined = prose.join("\n").trim();
    if (joined) blocks.push({ code: false, text: joined });
    prose = [];
  };
  for (const line of text.split("\n")) {
    const fence = /^\s*```(.*)$/.exec(line);
    if (code) {
      if (fence && !fence[1]!.trim()) {
        blocks.push({ code: true, lang: code.lang, text: code.lines.join("\n") });
        code = null;
      } else code.lines.push(line);
    } else if (fence) {
      flushProse();
      code = { lang: fence[1]!.trim(), lines: [] };
    } else prose.push(line);
  }
  if (code) blocks.push({ code: true, lang: code.lang, text: code.lines.join("\n") });
  flushProse();
  return blocks;
}
