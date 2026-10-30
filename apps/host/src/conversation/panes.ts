import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readPaneOf(pid: number): string | null {
  try {
    const env =
      process.platform === "linux"
        ? readFileSync(`/proc/${pid}/environ`, "utf8").replace(/\0/g, " ")
        : execFileSync("ps", ["eww", "-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
    // herdr's pane first: herdr running inside a Rex pane passes REX_BLOCK down to its own panes.
    return /(?:^|\s)HERDR_PANE_ID=(\S+)/.exec(env)?.[1] ?? /(?:^|\s)REX_BLOCK=(\S+)/.exec(env)?.[1] ?? null;
  } catch {
    return null;
  }
}

const panes = new Map<number, string | null>();

/** The pane a process runs in, from the HERDR_PANE_ID herdr, or the REX_BLOCK Rex, gives everything it starts. */
export function paneOfProcess(pid: number): string | null {
  if (!panes.has(pid)) {
    if (panes.size > 500) panes.clear();
    panes.set(pid, readPaneOf(pid));
  }
  return panes.get(pid)!;
}
