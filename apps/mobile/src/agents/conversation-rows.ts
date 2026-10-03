import type { ContextUsage, ConversationEntry, ImageRef, QueuedMessage } from "@shepherd/protocol";

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
  | { key: string; kind: "orphan_result"; result: ToolResult }
  /** A message waiting in the agent's own queue. */
  | { key: string; kind: "queued"; message: QueuedMessage }
  /** A run of tool calls (and thinking) between messages, folded into one line. */
  | { key: string; kind: "group"; rows: Row[]; tools: number; names: [string, number][]; failed: boolean };

/** Fold runs of at least this many tool calls. */
const GROUP_MIN_TOOLS = 3;

const isActivity = (row: Row) =>
  row.kind === "tool" || row.kind === "orphan_result" || (row.kind === "message" && row.entry.kind === "thinking");

function group(rows: Row[]): Row {
  const counts = new Map<string, number>();
  let tools = 0;
  let failed = false;
  for (const row of rows) {
    if (row.kind !== "tool") continue;
    tools++;
    counts.set(row.call.name, (counts.get(row.call.name) ?? 0) + 1);
    if (row.result && !row.result.ok) failed = true;
  }
  const names = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return { key: `g${rows[0]!.key}`, kind: "group", rows, tools, names, failed };
}

/**
 * Fold each run of tool calls between messages into one row. The run at the
 * end stays open: the agent may still be in the middle of it.
 */
export function groupActivity(rows: Row[]): Row[] {
  const out: Row[] = [];
  let run: Row[] = [];
  const flush = (trailing: boolean) => {
    const tools = run.filter((r) => r.kind === "tool").length;
    if (!trailing && tools >= GROUP_MIN_TOOLS) out.push(group(run));
    else out.push(...run);
    run = [];
  };
  for (const row of rows) {
    if (isActivity(row)) run.push(row);
    else {
      flush(false);
      out.push(row);
    }
  }
  flush(true);
  return out;
}

/** The images a tool row's result (or a group's results) brought back, to show without unfolding it. */
export function rowImages(row: Row): ImageRef[] {
  if (row.kind === "tool") return row.result?.images ?? [];
  if (row.kind === "orphan_result") return row.result.images ?? [];
  if (row.kind === "group") return row.rows.flatMap(rowImages);
  return [];
}

/** Queued messages as rows, newest first like the rest of the (inverted) list. */
export function queuedRows(queued: QueuedMessage[]): Row[] {
  return queued.map((message, i) => ({ key: `q${i}:${message.at ?? ""}:${message.text.slice(0, 24)}`, kind: "queued" as const, message })).reverse();
}

const isUserMessage = (row: Row) => row.kind === "message" && row.entry.kind === "user";

/**
 * Where the jump arrows go, in the inverted list (0 is the newest row): the
 * nearest of your messages older than the oldest row on screen, or newer than
 * the newest. null when there isn't one (loaded).
 */
export function userMessageIndex(rows: Row[], visible: { newest: number; oldest: number }, direction: "older" | "newer"): number | null {
  if (direction === "older") {
    for (let i = visible.oldest + 1; i < rows.length; i++) if (isUserMessage(rows[i]!)) return i;
    return null;
  }
  for (let i = visible.newest - 1; i >= 0; i--) if (isUserMessage(rows[i]!)) return i;
  return null;
}

export function countUserMessages(rows: Row[]): number {
  return rows.filter(isUserMessage).length;
}

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

/** "62% context" when the agent records its window (Codex), else how many tokens: "125k context". */
export function contextLabel(context: ContextUsage | null): { text: string; high: boolean } | null {
  if (!context || context.used <= 0) return null;
  if (context.window) {
    const percent = Math.min(100, Math.round((context.used / context.window) * 100));
    return { text: `${percent}% context`, high: percent >= 80 };
  }
  const tokens = context.used >= 1_000_000 ? `${(context.used / 1_000_000).toFixed(1)}M` : `${Math.max(1, Math.round(context.used / 1000))}k`;
  return { text: `${tokens} context`, high: false };
}
