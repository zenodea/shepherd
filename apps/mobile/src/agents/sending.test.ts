import { describe, expect, it } from "vitest";
import { stillSending } from "./sending";

describe("messages being sent", () => {
  const sent = { id: "a", text: "Run the tests  again\nplease", after: 4 };
  it("stays until the conversation or the queue has it", () => {
    expect(stillSending([sent], [{ id: 3, kind: "user", text: "Run the tests again please" }], [])).toEqual([sent]);
    expect(stillSending([sent], [{ id: 5, kind: "user", text: "Run the tests again please" }], [])).toEqual([]);
    expect(stillSending([sent], [], [{ text: "Run the tests again\nplease" }])).toEqual([]);
    expect(stillSending([sent], [{ id: 6, kind: "user", text: "something else" }], [])).toEqual([sent]);
  });
});
