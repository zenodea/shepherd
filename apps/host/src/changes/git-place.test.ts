import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readGitPlace } from "./git-place.ts";

describe("readGitPlace", () => {
  const root = mkdtempSync(join(tmpdir(), "git-place-"));
  const repo = join(root, "app");
  mkdirSync(join(repo, ".git", "worktrees", "ui"), { recursive: true });
  writeFileSync(join(repo, ".git", "worktrees", "ui", "HEAD"), "ref: refs/heads/pack/ru4/ui\n");
  mkdirSync(join(repo, "src"));
  const worktree = join(root, "app-wt", "ui");
  mkdirSync(join(worktree, "lib"), { recursive: true });
  writeFileSync(join(worktree, ".git"), `gitdir: ${repo}/.git/worktrees/ui\n`);
  const submodule = join(repo, "vendor");
  mkdirSync(submodule);
  writeFileSync(join(submodule, ".git"), "gitdir: ../.git/modules/vendor\n");

  it("finds the main checkout from any folder in it", () => {
    expect(readGitPlace(join(repo, "src"))).toEqual({ repo, worktree: false, branch: null });
  });

  it("knows a linked worktree's main checkout and branch", () => {
    expect(readGitPlace(join(worktree, "lib"))).toEqual({ repo, worktree: true, branch: "pack/ru4/ui" });
  });

  it("treats a submodule as its own checkout, and outside git as nothing", () => {
    expect(readGitPlace(submodule)).toEqual({ repo: submodule, worktree: false, branch: null });
    expect(readGitPlace(join(root, "app-wt"))).toBeNull();
  });
});
