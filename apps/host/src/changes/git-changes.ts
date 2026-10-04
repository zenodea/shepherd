// What an agent has changed in its folder, from git, read-only. Nothing is
// stored: every call asks git again.
import { execFile } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
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
      // No pager, colour, fsmonitor hook or external diff tools; never take the index lock from under the agent.
      ["-c", "core.quotepath=off", "-c", "color.ui=false", "-c", "core.fsmonitor=false", ...args],
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

/** Never run the repository's own diff programs (textconv, external diff) over the agent's files. */
const DIFF = ["-M", "--no-ext-diff", "--no-textconv"];
/** Enough of a file to tell text from binary, as git does. */
const SNIFF_BYTES = 8000;

/**
 * An untracked file's bytes (only the start when it's too big to show).
 * Null for anything but a regular file: a link, a pipe or a device is never opened or followed.
 */
function readNewFile(path: string): { bytes: Buffer; truncated: boolean } | null {
  try {
    if (!lstatSync(path).isFile()) return null;
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) return null;
      const truncated = stat.size > MAX_NEW_FILE_BYTES;
      const buffer = Buffer.alloc(truncated ? SNIFF_BYTES : stat.size);
      return { bytes: buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0)), truncated };
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

const isBinary = (bytes: Buffer) => bytes.subarray(0, SNIFF_BYTES).includes(0);

function lineCount(bytes: Buffer): number {
  let lines = 0;
  for (let nl = bytes.indexOf(0x0a); nl !== -1; nl = bytes.indexOf(0x0a, nl + 1)) lines++;
  return bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a ? lines + 1 : lines;
}

/** How a file changed compared with `against`, by its path now. */
async function statuses(r: Repo, against: string): Promise<Map<string, { status: ChangedFile["status"]; oldPath?: string }>> {
  const status = fields(await git(r.root, ["diff", against, ...DIFF, "--name-status", "-z"]));
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
  return statusOf;
}

type Listed = { files: ChangedFile[]; omitted: number; additions: number; deletions: number };

/**
 * Changed files compared with `against` (a commit), working tree included, plus
 * untracked files: the first MAX_FILES, and only those are read.
 */
async function changedFiles(r: Repo, against: string, cwd: string): Promise<Listed> {
  const files = new Map<string, ChangedFile>();
  const mention = (path: string) => relative(cwd, join(r.root, path)) || basename(path);
  const add = (path: string, file: Omit<ChangedFile, "path" | "generated" | "mention">) =>
    files.set(path, { path, ...file, generated: GENERATED.test(path), mention: mention(path) });

  const statusOf = await statuses(r, against);
  const numstat = fields(await git(r.root, ["diff", against, ...DIFF, "--numstat", "-z"]));
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
  const untracked = new Set(fields(await git(r.root, ["ls-files", "--others", "--exclude-standard", "-z"])));
  for (const path of untracked) add(path, { status: "added", additions: 0, deletions: 0, binary: false });

  const all = [...files.values()].sort((a, b) => Number(a.generated) - Number(b.generated) || a.path.localeCompare(b.path));
  const shown = all.slice(0, MAX_FILES);
  for (const file of shown) {
    const read = untracked.has(file.path) ? readNewFile(join(r.root, file.path)) : null;
    if (!read) continue;
    file.binary = isBinary(read.bytes);
    file.additions = file.binary || read.truncated ? 0 : lineCount(read.bytes);
  }
  return {
    files: shown,
    omitted: all.length - shown.length,
    additions: all.reduce((n, f) => n + f.additions, 0),
    deletions: all.reduce((n, f) => n + f.deletions, 0),
  };
}

/** The commit to compare with in `mode`: the branch's base, or HEAD for what's not committed yet. */
const againstFor = (r: Repo, branch: { mergeBase: string } | null) => branch?.mergeBase ?? (r.hasHead ? "HEAD" : EMPTY_TREE);

async function resolveMode(r: Repo, cwd: string, mode: ChangesMode | undefined) {
  const branch = await branchBase(r);
  const uncommitted = () => changedFiles(r, againstFor(r, null), cwd);
  if (mode === "branch" && branch) return { mode, branch, listed: await changedFiles(r, branch.mergeBase, cwd) };
  if (mode === "uncommitted" || !branch) return { mode: "uncommitted" as const, branch, listed: await uncommitted() };
  // No mode asked for: what's not committed yet, or if that's nothing, the whole branch.
  const listed = await uncommitted();
  if (listed.files.length > 0) return { mode: "uncommitted" as const, branch, listed };
  return { mode: "branch" as const, branch, listed: await changedFiles(r, branch.mergeBase, cwd) };
}

export async function changes(cwd: string, mode?: ChangesMode): Promise<ChangesResult> {
  const r = await repo(cwd);
  if (!r) return { available: false, reason: "This agent's folder isn't a git repository." };
  const { mode: resolved, branch, listed } = await resolveMode(r, cwd, mode);
  return {
    available: true,
    mode: resolved,
    branch: r.branch,
    base: branch?.base ?? null,
    canCompareBranch: branch !== null,
    files: listed.files,
    ...(listed.omitted ? { omitted: listed.omitted } : {}),
    additions: listed.additions,
    deletions: listed.deletions,
  };
}

/** One changed file's diff. Only files with changes can be asked for. */
export async function fileDiff(cwd: string, path: string, mode: ChangesMode): Promise<FileDiffResult> {
  const r = await repo(cwd);
  if (!r) return { available: false, reason: "This agent's folder isn't a git repository." };
  const full = resolve(r.root, path);
  if (!full.startsWith(r.root + sep)) return { available: false, reason: "That file is outside the repository." };
  const against = againstFor(r, mode === "branch" ? await branchBase(r) : null);

  const known = (await statuses(r, against)).get(path);
  if (known) {
    const paths = known.oldPath ? [known.oldPath, path] : [path];
    const out = await git(r.root, ["diff", against, ...DIFF, "-U3", "--", ...paths]);
    const diff: FileDiff = parseUnifiedDiff(out, path)[0] ?? { path, hunks: [], additions: 0, deletions: 0 };
    return { available: true, diff: { ...diff, path } };
  }
  const untracked = await tryGit(r.root, ["ls-files", "--others", "--exclude-standard", "-z", "--", path]);
  if (!untracked?.split("\0").includes(path)) return { available: false, reason: "That file has no changes any more." };
  const read = readNewFile(full);
  const empty = { path, hunks: [], additions: 0, deletions: 0 };
  if (!read) return { available: true, diff: empty };
  if (isBinary(read.bytes)) return { available: true, diff: { ...empty, binary: true } };
  if (read.truncated) return { available: true, diff: { ...empty, truncated: true } };
  return { available: true, diff: addedFile(path, read.bytes.toString("utf8")) };
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
