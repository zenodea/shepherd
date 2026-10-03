import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { Folder, FoldersResult } from "@shepherd/protocol";

/** Where people usually keep their repositories, searched two levels deep for suggestions. */
const CODE_FOLDERS = ["Work", "work", "code", "Code", "projects", "Projects", "src", "dev", "Developer", "github", "repos", "git"];
const MAX_LISTED = 300;
const MAX_REPOS = 25;
const MAX_RECENT = 8;

export class FolderError extends Error {}

const isDir = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const folder = (path: string): Folder => ({ name: basename(path), path, repo: existsSync(join(path, ".git")) });

/** Folders under your home folder only: what a phone can browse and start agents in. */
export class Folders {
  readonly home: string;

  constructor(home = homedir()) {
    this.home = real(home);
  }

  /** A folder you typed or picked, checked: it exists, it's a folder, and it's in your home folder. */
  resolve(input: string): string {
    const expanded = input.trim().replace(/^~(?=$|\/)/, this.home);
    if (!expanded.startsWith("/")) throw new FolderError("Use a full path, like ~/Work/app.");
    const path = real(resolve(expanded));
    if (path !== this.home && !path.startsWith(this.home + sep)) throw new FolderError("Only folders inside your home folder.");
    if (!isDir(path)) throw new FolderError(`${input.trim()} isn't a folder on this computer.`);
    return path;
  }

  list(input: string | undefined, recentCwds: string[]): FoldersResult {
    const path = input ? this.resolve(input) : this.home;
    let names: string[] = [];
    try {
      names = readdirSync(path);
    } catch {
      // unreadable: show it empty
    }
    const folders = names
      .filter((n) => !n.startsWith(".") && n !== "node_modules" && isDir(join(path, n)))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .slice(0, MAX_LISTED)
      .map((n) => folder(join(path, n)));
    return {
      path,
      parent: path === this.home ? null : dirname(path),
      folders,
      ...(input ? {} : { suggestions: { recent: this.recent(recentCwds), repos: this.repos() } }),
    };
  }

  private recent(cwds: string[]): Folder[] {
    const seen = new Set<string>();
    const out: Folder[] = [];
    for (const cwd of cwds) {
      const path = real(cwd);
      if (seen.has(path) || path === this.home || !path.startsWith(this.home + sep) || !isDir(path)) continue;
      seen.add(path);
      out.push(folder(path));
      if (out.length >= MAX_RECENT) break;
    }
    return out;
  }

  private repos(): Folder[] {
    const found: { path: string; at: number }[] = [];
    const visit = (dir: string, depth: number) => {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (name.startsWith(".") || name === "node_modules") continue;
        const path = join(dir, name);
        if (!isDir(path)) continue;
        if (existsSync(join(path, ".git"))) found.push({ path, at: statSync(path).mtimeMs });
        else if (depth > 1) visit(path, depth - 1);
      }
    };
    for (const name of CODE_FOLDERS) if (isDir(join(this.home, name))) visit(join(this.home, name), 2);
    // Work and work are the same folder on a case-insensitive disk (macOS, Windows).
    const sameFolder = (path: string) => (process.platform === "linux" ? real(path) : real(path).toLowerCase());
    const unique = [...new Map(found.map((f) => [sameFolder(f.path), f])).values()];
    return unique
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_REPOS)
      .map((f) => folder(f.path));
  }
}
