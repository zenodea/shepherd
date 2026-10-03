import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addedFile, editsDiff, lineDiff, parseUnifiedDiff } from "./diff.ts";
import { changes, changesParams, fileDiff, fileDiffParams } from "./git-changes.ts";

describe("diffs", () => {
  it("diffs an edit line by line, removals before additions", () => {
    const diff = lineDiff("a.ts", "const a = 1;\nconst b = 2;\nreturn a;\n", "const a = 1;\nconst b = 3;\nconst c = 4;\nreturn a;\n");
    expect(diff.hunks[0]!.lines.map((l) => `${l.kind}:${l.text}`)).toEqual([
      "ctx:const a = 1;",
      "del:const b = 2;",
      "add:const b = 3;",
      "add:const c = 4;",
      "ctx:return a;",
    ]);
    expect(diff).toMatchObject({ additions: 2, deletions: 1 });
    expect(editsDiff("a.ts", [{ before: "x", after: "y" }, { before: "", after: "z" }]).hunks).toHaveLength(2);
    expect(addedFile("n.ts", "one\ntwo\n")).toMatchObject({ additions: 2, hunks: [{ lines: [{ new: 1 }, { new: 2 }] }] });
  });

  it("parses git's unified diff, and bare hunks", () => {
    const [file] = parseUnifiedDiff(
      ["diff --git a/src/x.ts b/src/x.ts", "--- a/src/x.ts", "+++ b/src/x.ts", "@@ -10,3 +10,3 @@ fn", " keep", "-old", "+new", " keep", ""].join("\n"),
    );
    expect(file).toMatchObject({ path: "src/x.ts", additions: 1, deletions: 1 });
    expect(file!.hunks[0]!.lines).toEqual([
      { kind: "ctx", text: "keep", old: 10, new: 10 },
      { kind: "del", text: "old", old: 11 },
      { kind: "add", text: "new", new: 11 },
      { kind: "ctx", text: "keep", old: 12, new: 12 },
    ]);
    expect(parseUnifiedDiff("@@ -1 +1 @@\n-a\n+b\n", "/abs/y.ts")[0]).toMatchObject({ path: "/abs/y.ts", additions: 1, deletions: 1 });
  });

  it("cuts very long diffs short and says so", () => {
    const big = addedFile("big.txt", "x\n".repeat(5000));
    expect(big.truncated).toBe(true);
    expect(big.additions).toBe(5000);
    expect(big.hunks[0]!.lines.length).toBe(3000);
  });
});

describe("changes in a git repository", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString();
  const repo = () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "shepherd-git-")));
    dirs.push(dir);
    run(dir, "init", "-q", "-b", "main");
    run(dir, "config", "user.email", "t@example.com");
    run(dir, "config", "user.name", "Test");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.ts"), "one\ntwo\nthree\n");
    writeFileSync(join(dir, "src", "old.ts"), "moved\ncontent\nhere\n");
    writeFileSync(join(dir, "gone.ts"), "bye\n");
    run(dir, "add", ".");
    run(dir, "commit", "-q", "-m", "start");
    return dir;
  };

  it("lists uncommitted changes, with mentions relative to the agent's folder", async () => {
    const dir = repo();
    writeFileSync(join(dir, "src", "a.ts"), "one\n2\nthree\nfour\n");
    run(dir, "mv", "src/old.ts", "src/new.ts");
    run(dir, "rm", "-q", "gone.ts");
    writeFileSync(join(dir, "src", "fresh.ts"), "a\nb\n");
    writeFileSync(join(dir, "package-lock.json"), "{}\n");

    const result = await changes(join(dir, "src"));
    if (!result.available) throw new Error(result.reason);
    expect(result).toMatchObject({ mode: "uncommitted", branch: "main", canCompareBranch: false });
    const byPath = Object.fromEntries(result.files.map((f) => [f.path, f]));
    expect(byPath["src/a.ts"]).toMatchObject({ status: "modified", additions: 2, deletions: 1, mention: "a.ts" });
    expect(byPath["src/new.ts"]).toMatchObject({ status: "renamed", oldPath: "src/old.ts" });
    expect(byPath["gone.ts"]).toMatchObject({ status: "deleted", deletions: 1, mention: "../gone.ts" });
    expect(byPath["src/fresh.ts"]).toMatchObject({ status: "added", additions: 2 });
    expect(byPath["package-lock.json"]).toMatchObject({ generated: true });
    // Generated files go last.
    expect(result.files.at(-1)!.path).toBe("package-lock.json");

    const diff = await fileDiff(dir, "src/a.ts", "uncommitted");
    expect(diff).toMatchObject({ available: true, diff: { path: "src/a.ts", additions: 2, deletions: 1 } });
    const fresh = await fileDiff(dir, "src/fresh.ts", "uncommitted");
    expect(fresh).toMatchObject({ available: true, diff: { additions: 2 } });
  });

  it("only diffs files that are in the changes", async () => {
    const dir = repo();
    writeFileSync(join(dir, "secret.txt"), "not a change of the agent's\n");
    run(dir, "add", "secret.txt");
    run(dir, "commit", "-q", "-m", "secret");
    expect(await fileDiff(dir, "secret.txt", "uncommitted")).toMatchObject({ available: false });
    expect(await fileDiff(dir, "../../etc/passwd", "uncommitted")).toMatchObject({ available: false });
  });

  it("falls back to the whole branch when nothing is uncommitted", async () => {
    const dir = repo();
    run(dir, "checkout", "-q", "-b", "feature");
    writeFileSync(join(dir, "src", "a.ts"), "one\ntwo\nthree\nmore\n");
    run(dir, "commit", "-q", "-am", "work");

    const result = await changes(dir);
    expect(result).toMatchObject({ available: true, mode: "branch", branch: "feature", base: "main", canCompareBranch: true });
    expect(await changes(dir, "uncommitted")).toMatchObject({ available: true, mode: "uncommitted", files: [] });
    expect(await fileDiff(dir, "src/a.ts", "branch")).toMatchObject({ available: true, diff: { additions: 1 } });
  });

  it("explains a folder that isn't a repository, and validates parameters", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "shepherd-nogit-")));
    dirs.push(dir);
    expect(await changes(dir)).toMatchObject({ available: false });
    const isPane = (v: unknown): v is string => v === "w1:p1";
    expect(changesParams({ paneId: "w1:p1", mode: "branch" }, isPane)).toEqual({ paneId: "w1:p1", mode: "branch" });
    expect(changesParams({ paneId: "w1:p1", mode: "everything" }, isPane)).toBeNull();
    expect(fileDiffParams({ paneId: "w1:p1", path: "a\0b", mode: "uncommitted" }, isPane)).toBeNull();
  });
});
