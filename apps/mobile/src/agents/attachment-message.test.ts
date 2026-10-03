import { describe, expect, it } from "vitest";
import { withImages } from "./attachment-message";

describe("messages with images", () => {
  const ready = (path: string) => ({ id: path, uri: "", state: "ready" as const, path });
  it("puts the paths after the message, and says what to do when there's no text", () => {
    expect(withImages("Why is this broken?", [ready("/tmp/a.png")])).toBe("Why is this broken?\n\n[Image: /tmp/a.png]");
    expect(withImages("", [ready("/tmp/a.png"), ready("/tmp/b.png")])).toBe("Have a look at these images:\n[Image: /tmp/a.png]\n[Image: /tmp/b.png]");
    expect(withImages("hi", [{ id: "x", uri: "", state: "uploading" }])).toBe("hi");
  });
});
