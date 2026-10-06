import { describe, expect, it } from "vitest";
import { CardFormatError, parseCardBody } from "./plugins.ts";

describe("parseCardBody", () => {
  it("keeps the rows and buttons it knows, with sizes capped", () => {
    const body = parseCardBody({
      rows: [
        { kind: "text", label: "Branch", value: "main" },
        { kind: "badge", text: "penned", tone: "ok" },
        { kind: "badge", text: "odd", tone: "purple" },
        { kind: "list", items: ["a", { text: "b", detail: "more" }, 3] },
        { kind: "sparkline", values: [1, 2, 3] },
      ],
      buttons: [{ label: "Review", action: "open", confirm: "Open in the browser?", tone: "neutral" }, { label: "Map", pane: "tui" }],
    });
    expect(body).toEqual({
      rows: [
        { kind: "text", label: "Branch", value: "main" },
        { kind: "badge", text: "penned", tone: "ok" },
        { kind: "badge", text: "odd", tone: "neutral" },
        { kind: "list", items: [{ text: "a" }, { text: "b", detail: "more" }] },
      ],
      buttons: [{ label: "Review", action: "open", confirm: "Open in the browser?", tone: "neutral" }, { label: "Map", pane: "tui" }],
    });
    const long = parseCardBody({ rows: [{ kind: "text", value: "x".repeat(5000) }] });
    expect(long !== "hide" && (long.rows[0] as { value: string }).value).toHaveLength(2000);
  });

  it("lets a card step aside, and accepts an empty object", () => {
    expect(parseCardBody({ hide: true })).toBe("hide");
    expect(parseCardBody({})).toEqual({ rows: [], buttons: [] });
  });

  it("says what's wrong with bad output", () => {
    expect(() => parseCardBody("text")).toThrow(CardFormatError);
    expect(() => parseCardBody({ rows: [{ kind: "text" }] })).toThrow(/rows\[0\]: a text row needs a "value"/);
    expect(() => parseCardBody({ rows: [{ value: "no kind" }] })).toThrow(/needs a "kind"/);
    expect(() => parseCardBody({ buttons: [{ label: "Both", action: "a", pane: "b" }] })).toThrow(/exactly one of "action" or "pane"/);
    expect(() => parseCardBody({ buttons: [{ label: "Neither" }] })).toThrow(/exactly one/);
    expect(() => parseCardBody({ buttons: [{ label: "Bad id", action: "../x" }] })).toThrow(/exactly one/);
  });
});
