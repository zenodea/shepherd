// The markdown agents write, parsed for drawing natively: headings, lists,
// tables, quotes, code and links. Not all of CommonMark, but what agents use.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold" | "italic" | "strike"; children: Inline[] }
  | { kind: "link"; url: string; children: Inline[] };

export type Align = "left" | "center" | "right" | null;

export type MdBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "list"; items: { text: string; depth: number; marker: string; checked: boolean | null }[] }
  | { kind: "quote"; text: string }
  | { kind: "table"; header: string[]; align: Align[]; rows: string[][] }
  | { kind: "rule" };

const FENCE = /^\s*(```|~~~)(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** A table row's cells: split on unescaped pipes, outside `code`. */
export function tableCells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let code = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]!;
    if (ch === "\\" && row[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (ch === "`") {
      code = !code;
      cell += ch;
    } else if (ch === "|" && !code) {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

const isTableStart = (line: string, next: string | undefined) =>
  line.includes("|") && next !== undefined && next.includes("-") && TABLE_DIVIDER.test(next) && tableCells(line).length === tableCells(next).length;

/** Split markdown into blocks. */
export function parseMarkdown(text: string): MdBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    const joined = paragraph.join("\n").trim();
    if (joined) blocks.push({ kind: "paragraph", text: joined });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const close = fence[1]!;
      const body: string[] = [];
      for (i++; i < lines.length && !new RegExp(`^\\s*${close}\\s*$`).test(lines[i]!); i++) body.push(lines[i]!);
      blocks.push({ kind: "code", lang: fence[2]!.trim(), text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]! });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    if (isTableStart(line, lines[i + 1])) {
      flush();
      const header = tableCells(line);
      const align: Align[] = tableCells(lines[i + 1]!).map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null,
      );
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.includes("|") && lines[i]!.trim(); i++) {
        const cells = tableCells(lines[i]!);
        rows.push(header.map((_, c) => cells[c] ?? ""));
      }
      i--;
      blocks.push({ kind: "table", header, align, rows });
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const body: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]!); i++) body.push(QUOTE.exec(lines[i]!)![1]!);
      i--;
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flush();
      const items: Extract<MdBlock, { kind: "list" }>["items"] = [];
      const base = item[1]!.length;
      for (; i < lines.length; i++) {
        const l = lines[i]!;
        const m = LIST_ITEM.exec(l);
        if (m) {
          const task = /^\[([ xX])\]\s+(.*)$/.exec(m[3]!);
          items.push({
            depth: Math.min(4, Math.floor(Math.max(0, m[1]!.length - base) / 2)),
            marker: m[2]!,
            text: task ? task[2]! : m[3]!,
            checked: task ? task[1] !== " " : null,
          });
        } else if (l.trim() && /^\s+/.test(l) && items.length) {
          // A wrapped line of the item above.
          items[items.length - 1]!.text += `\n${l.trim()}`;
        } else break;
      }
      i--;
      blocks.push({ kind: "list", items });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

// `code`, [links](url), <url>, bare URLs, **bold**, __bold__, ~~strike~~, *italic*, _italic_, \* (escaped).
const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"*_~\]])|\*\*(?=\S)([\s\S]*?\S)\*\*|(?<![\w])__(?=\S)([\s\S]*?\S)__(?![\w])|~~(?=\S)([\s\S]*?\S)~~|\*(?=[^\s*])([^*\n]*?[^\s*])\*|(?<![\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w])|\\([\\`*_~[\]()#|>-])/g;

/** Inline markdown into nested spans. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (t: string) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev?.kind === "text") prev.text += t;
    else out.push({ kind: "text", text: t });
  };
  for (const m of text.matchAll(INLINE)) {
    const at = m.index!;
    push(text.slice(last, at));
    last = at + m[0].length;
    if (m[2] !== undefined) out.push({ kind: "code", text: m[2].trim() || m[2] });
    else if (m[3] !== undefined) out.push({ kind: "link", url: m[4]!, children: parseInline(m[3]) });
    else if (m[5] !== undefined) out.push({ kind: "link", url: m[5], children: [{ kind: "text", text: m[5] }] });
    else if (m[6] !== undefined) out.push({ kind: "link", url: m[6], children: [{ kind: "text", text: m[6] }] });
    else if (m[7] !== undefined || m[8] !== undefined) out.push({ kind: "bold", children: parseInline((m[7] ?? m[8])!) });
    else if (m[9] !== undefined) out.push({ kind: "strike", children: parseInline(m[9]) });
    else if (m[12] !== undefined) push(m[12]);
    else out.push({ kind: "italic", children: parseInline((m[10] ?? m[11])!) });
  }
  push(text.slice(last));
  return out;
}

/** Plain text of inline markdown, e.g. to size a table column. */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.kind === "text" || n.kind === "code" ? n.text : inlineText(n.children))).join("");
}

/** Links worth opening: web pages and mail; not relative paths or javascript:. */
export function openableUrl(url: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(url);
}
