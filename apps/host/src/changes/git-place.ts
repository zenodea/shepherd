// Which git checkout a folder is in, and whether it's a linked worktree (`git worktree add`), so the
// app can list worktree agents under the agent in the main checkout. Read straight from `.git`,
// without running git: it's asked for every agent each time the list changes.
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { GitPlace } from "@shepherd/protocol";

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; place: GitPlace | null }>();

/** The checkout `cwd` is in, or null outside git. Cached for a little while per folder. */
export function gitPlace(cwd: string, now = Date.now()): GitPlace | null {
  const hit = cache.get(cwd);
  if (hit && now - hit.at < TTL_MS) return hit.place;
  const place = readGitPlace(cwd);
  if (cache.size > 500) cache.clear();
  cache.set(cwd, { at: now, place });
  return place;
}

export function readGitPlace(cwd: string): GitPlace | null {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const dotGit = join(dir, ".git");
    try {
      if (statSync(dotGit).isDirectory()) return { repo: dir, worktree: false, branch: null };
      // A file: "gitdir: <main repo>/.git/worktrees/<name>" in a linked worktree (a submodule points into .git/modules).
      const gitdir = resolve(dir, readFileSync(dotGit, "utf8").replace(/^gitdir:\s*/, "").trim());
      const linked = /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(gitdir);
      if (!linked) return { repo: dir, worktree: false, branch: null };
      return { repo: linked[1]!, worktree: true, branch: branchOf(gitdir) };
    } catch {
      // no .git here (or unreadable): keep going up
    }
    if (dirname(dir) === dir) return null;
  }
}

function branchOf(gitdir: string): string | null {
  try {
    return /^ref: refs\/heads\/(.+)$/m.exec(readFileSync(join(gitdir, "HEAD"), "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}
