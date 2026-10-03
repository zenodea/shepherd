import { describe, expect, it } from "vitest";
import { inlineText, openableUrl, parseInline, parseMarkdown, tableCells } from "./markdown-syntax";

describe("markdown blocks", () => {
  it("parses the blocks agents write", () => {
    const md = [
      "## Summary",
      "Fixed **two** things:",
      "",
      "- the login test",
      "  which was flaky",
      "  - nested detail",
      "1. first",
      "2. second",
      "- [x] done",
      "- [ ] not yet",
      "",
      "> a quote",
      "> on two lines",
      "",
      "---",
      "```ts",
      "const a = 1;",
      "",
      "```",
      "after",
    ].join("\n");
    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "quote", "rule", "code", "paragraph"]);
    expect(blocks[0]).toEqual({ kind: "heading", level: 2, text: "Summary" });
    const list = blocks[2] as Extract<(typeof blocks)[number], { kind: "list" }>;
    expect(list.items.map((i) => [i.depth, i.marker, i.text, i.checked])).toEqual([
      [0, "-", "the login test\nwhich was flaky", null],
      [1, "-", "nested detail", null],
      [0, "1.", "first", null],
      [0, "2.", "second", null],
      [0, "-", "done", true],
      [0, "-", "not yet", false],
    ]);
    expect(blocks[3]).toEqual({ kind: "quote", text: "a quote\non two lines" });
    expect(blocks[5]).toEqual({ kind: "code", lang: "ts", text: "const a = 1;\n" });
  });

  it("parses tables, with alignment, escaped pipes and short rows", () => {
    const md = ["| File | Lines | Note |", "|:-----|------:|:----:|", "| `a|b.ts` | 12 | ok \\| fine |", "| c.ts | 3 |", "", "next"].join("\n");
    const [table, next] = parseMarkdown(md);
    expect(table).toEqual({
      kind: "table",
      header: ["File", "Lines", "Note"],
      align: ["left", "right", "center"],
      rows: [
        ["`a|b.ts`", "12", "ok | fine"],
        ["c.ts", "3", ""],
      ],
    });
    expect(next).toEqual({ kind: "paragraph", text: "next" });
    // A pipe in prose isn't a table.
    expect(parseMarkdown("a | b\nnot a divider").map((b) => b.kind)).toEqual(["paragraph"]);
    expect(tableCells("a | b |")).toEqual(["a", "b"]);
  });

  it("keeps an unclosed code block to the end", () => {
    expect(parseMarkdown("```\nstill typing")).toEqual([{ kind: "code", lang: "", text: "still typing" }]);
  });
});

describe("inline markdown", () => {
  it("parses code, emphasis and links", () => {
    expect(parseInline("Run `npm test` then **check _this_** and ~~that~~.")).toEqual([
      { kind: "text", text: "Run " },
      { kind: "code", text: "npm test" },
      { kind: "text", text: " then " },
      { kind: "bold", children: [{ kind: "text", text: "check " }, { kind: "italic", children: [{ kind: "text", text: "this" }] }] },
      { kind: "text", text: " and " },
      { kind: "strike", children: [{ kind: "text", text: "that" }] },
      { kind: "text", text: "." },
    ]);
    expect(parseInline("See [the docs](https://herdr.dev/docs) or https://example.com/a_b.")).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", url: "https://herdr.dev/docs", children: [{ kind: "text", text: "the docs" }] },
      { kind: "text", text: " or " },
      { kind: "link", url: "https://example.com/a_b", children: [{ kind: "text", text: "https://example.com/a_b" }] },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves snake_case, lone stars and code contents alone", () => {
    expect(inlineText(parseInline("my_var_name and 2 * 3 * 4"))).toBe("my_var_name and 2 * 3 * 4");
    expect(parseInline("my_var_name")).toEqual([{ kind: "text", text: "my_var_name" }]);
    expect(parseInline("`**not bold**`")).toEqual([{ kind: "code", text: "**not bold**" }]);
    expect(inlineText(parseInline("a \\*literal\\* star"))).toBe("a *literal* star");
  });

  it("only opens web and mail links", () => {
    expect(openableUrl("https://x.dev")).toBe(true);
    expect(openableUrl("mailto:a@b.c")).toBe(true);
    expect(openableUrl("src/app.ts")).toBe(false);
    expect(openableUrl("javascript:alert(1)")).toBe(false);
  });
});
