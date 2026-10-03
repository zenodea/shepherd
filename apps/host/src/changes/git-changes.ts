// What an agent has changed in its folder, from git, read-only. Nothing is
// stored: every call asks git again.
import { execFile } from "node:child_process";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import type { ChangedFile, ChangesMode, ChangesResult, FileDiff, FileDiffResult } from "@shepherd/protocol";
import { addedFile, parseUnifiedDiff } from "./diff.ts";

const GIT_TIMEOUT_MS = 8000;
const MAX_OUTPUT = 32 * 1024 * 1024;
/** Files listed per answer; a long-lived branch can differ in thousands. */
const MAX_FILES = 400;
/** New files bigger than this are counted but not read for their diff. */
const MAX_NEW_FILE_BYTES = 2 * 1024 * 1024;

const GENERATED = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum|flake\.lock)$|\.(min\.(js|css)|map|snap)$/;

export class GitError extends Error {}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      // No pager, colour or external diff tools; never take the index lock from under the agent.
      ["-c", "core.quotepath=off", "-c", "color.ui=false", ...args],
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat" } },
      (err, stdout) => (err ? reject(new GitError(err.message)) : resolvePromise(stdout)),
    );
  });
}

const tryGit = (cwd: string, args: string[]) => git(cwd, args).then((out) => out.trim(), () => null);

type Repo = { root: string; branch: string | null; hasHead: boolean; defaultBranch: string | null };

async function repo(cwd: string): Promise<Repo | null> {
  const root = await tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return null;
  const hasHead = (await tryGit(root, ["rev-parse", "--verify", "--quiet", "HEAD"])) !== null;
  const branch = hasHead ? await tryGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) : null;
  let defaultBranch = await tryGit(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (!defaultBranch) {
    for (const name of ["main", "master"]) {
      if (await tryGit(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`])) {
        defaultBranch = name;
        break;
      }
    }
  }
  return { root, branch, hasHead, defaultBranch };
}

/** The branch this one is compared with, and where they split; null on the default branch itself. */
async function branchBase(r: Repo): Promise<{ base: string; mergeBase: string } | null> {
  if (!r.hasHead || !r.branch || !r.defaultBranch) return null;
  if (r.branch === r.defaultBranch || `origin/${r.branch}` === r.defaultBranch) return null;
  const mergeBase = await tryGit(r.root, ["merge-base", "HEAD", r.defaultBranch]);
  return mergeBase ? { base: r.defaultBranch, mergeBase } : null;
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** NUL-separated fields, as `-z` prints them. */
function fields(out: string): string[] {
  const parts = out.split("\0");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

function isBinaryFile(path: string): boolean {
  try {
    const fd = openSync(path, "r");
    try {
      const buffer = Buffer.alloc(8000);
      const read = readSync(fd, buffer, 0, buffer.length, 0);
      return buffer.subarray(0, read).includes(0);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

function lineCount(path: string): number {
  try {
    if (statSync(path).size > MAX_NEW_FILE_BYTES) return 0;
    const fd = openSync(path, "r");
    try {
      const buffer = Buffer.alloc(statSync(path).size);
      readSync(fd, buffer, 0, buffer.length, 0);
      if (buffer.length === 0) return 0;
      let lines = 0;
      for (const byte of buffer) if (byte === 0x0a) lines++;
      return buffer[buffer.length - 1] === 0x0a ? lines : lines + 1;
    } finally {
      closeSync(fd);
    }
  } catch {
    return 0;
  }
}

/** Changed files compared with `against` (a commit), working tree included, plus untracked files. */
async function changedFiles(r: Repo, against: string, cwd: string): Promise<ChangedFile[]> {
  const files = new Map<string, ChangedFile>();
  const mention = (path: string) => relative(cwd, join(r.root, path)) || basename(path);
  const add = (path: string, file: Omit<ChangedFile, "path" | "generated" | "mention">) =>
    files.set(path, { path, ...file, generated: GENERATED.test(path), mention: mention(path) });

  const status = fields(await git(r.root, ["diff", against, "-M", "--name-status", "-z", "--no-ext-diff"]));
  const statusOf = new Map<string, { status: ChangedFile["status"]; oldPath?: string }>();
  for (let i = 0; i < status.length; ) {
    const code = status[i++]!;
    if (code.startsWith("R") || code.startsWith("C")) {
      const oldPath = status[i++]!;
      const path = status[i++]!;
      statusOf.set(path, { status: code.startsWith("R") ? "renamed" : "added", oldPath });
    } else {
      const path = status[i++]!;
      statusOf.set(path, { status: code === "A" ? "added" : code === "D" ? "deleted" : "modified" });
    }
  }
  const numstat = fields(await git(r.root, ["diff", against, "-M", "--numstat", "-z", "--no-ext-diff"]));
  for (let i = 0; i < numstat.length; ) {
    const [added, deleted, maybePath] = numstat[i++]!.split("\t");
    // A rename prints an empty path, then the old and the new path.
    let path = maybePath!;
    if (path === "") {
      i++;
      path = numstat[i++]!;
    }
    const known = statusOf.get(path) ?? { status: "modified" as const };
    const binary = added === "-";
    add(path, { ...known, additions: binary ? 0 : Number(added), deletions: binary ? 0 : Number(deleted), binary });
  }
  for (const path of fields(await git(r.root, ["ls-files", "--others", "--exclude-standard", "-z"]))) {
    const full = join(r.root, path);
    const binary = isBinaryFile(full);
    add(path, { status: "added", additions: binary ? 0 : lineCount(full), deletions: 0, binary });
  }
  return [...files.values()].sort((a, b) => Number(a.generated) - Number(b.generated) || a.path.localeCompare(b.path));
}

async function resolveMode(r: Repo, cwd: string, mode: ChangesMode | undefined) {
  const branch = await branchBase(r);
  const uncommitted = () => changedFiles(r, r.hasHead ? "HEAD" : EMPTY_TREE, cwd);
  if (mode === "branch" && branch) return { mode, branch, against: branch.mergeBase, files: await changedFiles(r, branch.mergeBase, cwd) };
  if (mode === "uncommitted" || !branch) return { mode: "uncommitted" as const, branch, against: r.hasHead ? "HEAD" : EMPTY_TREE, files: await uncommitted() };
  // No mode asked for: what's not committed yet, or if that's nothing, the whole branch.
  const files = await uncommitted();
  if (files.length > 0) return { mode: "uncommitted" as const, branch, against: "HEAD", files };
  return { mode: "branch" as const, branch, against: branch.mergeBase, files: await changedFiles(r, branch.mergeBase, cwd) };
}

export async function changes(cwd: string, mode?: ChangesMode): Promise<ChangesResult> {
  const r = await repo(cwd);
  if (!r) return { available: false, reason: "This agent's folder isn't a git repository." };
  const resolved = await resolveMode(r, cwd, mode);
  return {
    available: true,
    mode: resolved.mode,
    branch: r.branch,
    base: resolved.branch?.base ?? null,
    canCompareBranch: resolved.branch !== null,
    files: resolved.files.slice(0, MAX_FILES),
    ...(resolved.files.length > MAX_FILES ? { omitted: resolved.files.length - MAX_FILES } : {}),
    additions: resolved.files.reduce((n, f) => n + f.additions, 0),
    deletions: resolved.files.reduce((n, f) => n + f.deletions, 0),
  };
}

/** One changed file's diff. Only files in the current list of changes can be asked for. */
export async function fileDiff(cwd: string, path: string, mode: ChangesMode): Promise<FileDiffResult> {
  const r = await repo(cwd);
  if (!r) return { available: false, reason: "This agent's folder isn't a git repository." };
  const resolved = await resolveMode(r, cwd, mode);
  const file = resolved.files.find((f) => f.path === path);
  if (!file) return { available: false, reason: "That file has no changes any more." };
  if (file.binary) return { available: true, diff: { path, hunks: [], additions: 0, deletions: 0, binary: true } };

  const tracked = !(file.status === "added" && !(await tryGit(r.root, ["ls-files", "--error-unmatch", "--", path])));
  if (!tracked) {
    const full = resolve(r.root, path);
    if (!full.startsWith(r.root + sep)) return { available: false, reason: "That file is outside the repository." };
    if (statSync(full).size > MAX_NEW_FILE_BYTES) return { available: true, diff: { path, hunks: [], additions: file.additions, deletions: 0, truncated: true } };
    const fd = openSync(full, "r");
    try {
      const buffer = Buffer.alloc(statSync(full).size);
      readSync(fd, buffer, 0, buffer.length, 0);
      return { available: true, diff: addedFile(path, buffer.toString("utf8")) };
    } finally {
      closeSync(fd);
    }
  }
  const paths = file.oldPath ? [file.oldPath, path] : [path];
  const out = await git(r.root, ["diff", resolved.against, "-M", "--no-ext-diff", "-U3", "--", ...paths]);
  const diff: FileDiff = parseUnifiedDiff(out, path)[0] ?? { path, hunks: [], additions: 0, deletions: 0 };
  return { available: true, diff: { ...diff, path } };
}

const MODES: readonly ChangesMode[] = ["uncommitted", "branch"];

/** Validate the app's parameters; null when malformed. */
export function changesParams(params: Record<string, unknown>, isPaneId: (v: unknown) => v is string): { paneId: string; mode?: ChangesMode } | null {
  const { paneId, mode } = params;
  if (!isPaneId(paneId)) return null;
  if (mode !== undefined && !MODES.includes(mode as ChangesMode)) return null;
  return { paneId, ...(mode ? { mode: mode as ChangesMode } : {}) };
}

export function fileDiffParams(
  params: Record<string, unknown>,
  isPaneId: (v: unknown) => v is string,
): { paneId: string; path: string; mode: ChangesMode } | null {
  const { paneId, path, mode } = params;
  if (!isPaneId(paneId) || !MODES.includes(mode as ChangesMode)) return null;
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) return null;
  return { paneId, path, mode: mode as ChangesMode };
}
