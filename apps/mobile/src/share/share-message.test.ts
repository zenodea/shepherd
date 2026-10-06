import { describe, expect, it } from "vitest";
import { shareMessage, sharedText } from "./share-message";

describe("shared text", () => {
  it("puts the subject over the text when they differ", () => {
    expect(sharedText({ subject: "Fix the build", text: "https://example.com/pr/1" })).toBe("Fix the build\nhttps://example.com/pr/1");
    expect(sharedText({ subject: "Same", text: "Same" })).toBe("Same");
    expect(sharedText({ subject: "Title", text: "Title — https://x.dev" })).toBe("Title — https://x.dev");
    expect(sharedText({ subject: "Only a subject" })).toBe("Only a subject");
    expect(sharedText({ text: "  a link  ", subject: " " })).toBe("a link");
    expect(sharedText({})).toBe("");
  });
});

describe("share messages", () => {
  it("puts the note first, then what was shared, then the images", () => {
    expect(shareMessage("Look at this", { text: "https://x.dev" }, [])).toBe("Look at this\n\nhttps://x.dev");
    expect(shareMessage("", { text: "https://x.dev" }, [])).toBe("https://x.dev");
    expect(shareMessage("Why?", { text: "error log" }, ["/tmp/a.png"])).toBe("Why?\n\nerror log\n\n[Image: /tmp/a.png]");
    expect(shareMessage("  ", {}, ["/tmp/a.png"])).toBe("Have a look at this image:\n[Image: /tmp/a.png]");
    expect(shareMessage("Fix this", {}, ["/tmp/a.png", "/tmp/b.png"])).toBe("Fix this\n\n[Image: /tmp/a.png]\n[Image: /tmp/b.png]");
  });
});
