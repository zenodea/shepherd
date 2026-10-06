import { describe, expect, it } from "vitest";
import { reviewMessage } from "./review-message";

describe("reviewMessage", () => {
  it("lists each comment with its file, line and code, in file order, with the note last", () => {
    const text = reviewMessage(
      [
        { id: "2", path: "src/tax.ts", side: "new", line: 42, code: "  const total = round(x)", text: "Use the shared rounding helper." },
        { id: "1", path: "src/api.ts", side: "old", line: 7, code: "retry(3)", text: "Why drop the retry?" },
        { id: "3", path: "src/tax.ts", side: "new", line: 9, code: "", text: "Name this better." },
      ],
      "  Otherwise looks good. ",
    );
    expect(text).toBe(
      [
        "Review of your changes (3 comments):",
        "src/api.ts:7 (a line you removed)\n> retry(3)\nWhy drop the retry?",
        "src/tax.ts:9\nName this better.",
        "src/tax.ts:42\n> const total = round(x)\nUse the shared rounding helper.",
        "Otherwise looks good.",
      ].join("\n\n"),
    );
  });
});
