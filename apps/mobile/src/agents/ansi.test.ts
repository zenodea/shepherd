import { describe, expect, it } from "vitest";
import { linesToHtml, parseAnsi } from "./ansi";

describe("parseAnsi", () => {
  it("keeps plain text and splits lines", () => {
    expect(parseAnsi("hello\r\nworld")).toEqual([[{ text: "hello" }], [{ text: "world" }]]);
  });

  it("applies and resets SGR styles", () => {
    expect(parseAnsi("\u001b[1;32mok\u001b[0m done")).toEqual([
      [
        { text: "ok", bold: true, color: "#4ADE80" },
        { text: " done" },
      ],
    ]);
  });

  it("supports 256-colour and truecolor", () => {
    const [line] = parseAnsi("\u001b[38;5;208ma\u001b[38;2;10;20;30mb");
    expect(line![0]!.color).toBe("rgb(255,135,0)");
    expect(line![1]!.color).toBe("rgb(10,20,30)");
  });

  it("carries style across lines and drops other escapes", () => {
    const lines = parseAnsi("\u001b[31mred\nstill red\u001b]8;;http://x\u0007link\u001b[2K\u001b[0m");
    expect(lines[1]).toEqual([{ text: "still red", color: "#F87171" }, { text: "link", color: "#F87171" }]);
  });

  it("trims trailing blank lines but keeps blank lines in between", () => {
    expect(parseAnsi("a\n\nb\n\n   \n")).toEqual([[{ text: "a" }], [], [{ text: "b" }]]);
  });
});

describe("linesToHtml", () => {
  it("escapes text and styles spans", () => {
    const html = linesToHtml(parseAnsi("\u001b[1;31m<b>&\u001b[0m ok\n\nend"));
    expect(html).toBe('<div><span style="color:#F87171;font-weight:700">&lt;b&gt;&amp;</span> ok</div><div> </div><div>end</div>');
  });
});
