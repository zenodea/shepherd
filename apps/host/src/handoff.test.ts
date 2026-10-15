import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversationEntry, HandoffRepo } from "@shepherd/protocol";
import { gitState } from "./changes/git-changes.ts";
import { handoffBrief } from "./handoff.ts";

const REPO: HandoffRepo = {
  name: "shepherd",
  branch: "feat/handoff",
  commit: "a1b2c3d",
  subject: "wip",
  remote: "git@github.com:me/shepherd.git",
  unpushed: 2,
  uncommitted: { count: 3, files: ["a.ts", "b.ts"] },
};

describe("handoff brief", () => {
  it("says where the code is and what stays behind", () => {
    const brief = handoffBrief({ from: "desk", agent: "claude", cwd: "/home/me/shepherd", repo: REPO, entries: [] });
    expect(brief).toContain('another claude agent was doing on my computer "desk"');
    expect(brief).toContain("Repository: shepherd (git@github.com:me/shepherd.git)");
    expect(brief).toContain('Branch feat/handoff, at a1b2c3d "wip"');
    expect(brief).toContain("2 commits not pushed");
    expect(brief).toContain("a.ts, b.ts and 1 more");
  });

  it("keeps the first request and as much of the end as fits", () => {
    const entries: ConversationEntry[] = [
      { id: 0, kind: "user", text: "Build the handoff" },
      ...Array.from({ length: 200 }, (_, i): ConversationEntry => ({ id: i + 1, kind: "assistant", text: `step ${i} ${"x".repeat(200)}` })),
      { id: 201, kind: "tool", callId: "c", name: "Edit", summary: "src/handoff.ts" },
      { id: 202, kind: "tool_result", callId: "c", ok: true, output: "secret output" },
    ];
    const brief = handoffBrief({ from: "desk", agent: null, cwd: null, repo: null, entries });
    expect(brief).toContain("## What was asked first\n> Build the handoff");
    expect(brief).toContain("step 199");
    expect(brief).not.toContain("step 0 ");
    expect(brief).toMatch(/- Edit: src\/handoff\.ts$/);
    expect(brief).not.toContain("secret output");
    expect(brief.length).toBeLessThanOrEqual(12_000);
  });
});

describe("git state", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString();

  it("reads branch, commit, a token-free remote and uncommitted files", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "shepherd-handoff-")));
    dirs.push(dir);
    run(dir, "init", "-q", "-b", "main");
    run(dir, "config", "user.email", "t@example.com");
    run(dir, "config", "user.name", "Test");
    writeFileSync(join(dir, "a.ts"), "one\n");
    run(dir, "add", ".");
    run(dir, "commit", "-q", "-m", "first commit");
    run(dir, "remote", "add", "origin", "https://user:ghp_token@github.com/me/proj.git");
    writeFileSync(join(dir, "a.ts"), "two\n");
    writeFileSync(join(dir, "new.ts"), "new\n");

    const state = await gitState(dir);
    expect(state).toMatchObject({
      name: "proj",
      branch: "main",
      subject: "first commit",
      remote: "https://github.com/me/proj.git",
      unpushed: null,
      uncommitted: { count: 2, files: ["a.ts", "new.ts"] },
    });
    expect(state?.commit).toMatch(/^[0-9a-f]{7,}$/);
  });
});
