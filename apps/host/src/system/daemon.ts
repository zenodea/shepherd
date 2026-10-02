// Run the host as a detached process, for the herdr plugin's startup hook.
// A pid file next to the config lets every way of starting the host (a
// terminal, the plugin, the service) see whether one is already running.
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type RunningHost = { pid: number; socketPath: string; startedAt: string };

export function pidFilePath(configPath: string): string {
  return join(dirname(configPath), "host.pid");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The running host, or null when there is none (a stale pid file is ignored). */
export function readRunningHost(configPath: string): RunningHost | null {
  try {
    const host = JSON.parse(readFileSync(pidFilePath(configPath), "utf8")) as RunningHost;
    return Number.isInteger(host.pid) && isAlive(host.pid) ? host : null;
  } catch {
    return null;
  }
}

export function writePidFile(configPath: string, socketPath: string): void {
  const host: RunningHost = { pid: process.pid, socketPath, startedAt: new Date().toISOString() };
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(pidFilePath(configPath), JSON.stringify(host) + "\n");
}

/** Remove the pid file if it is still this process's. */
export function clearPidFile(configPath: string): void {
  try {
    const host = JSON.parse(readFileSync(pidFilePath(configPath), "utf8")) as RunningHost;
    if (host.pid === process.pid) rmSync(pidFilePath(configPath), { force: true });
  } catch {
    // Already gone.
  }
}

/** herdr's per-invocation variables; the host must not inherit the pane or action that started it. */
const INVOCATION_ENV = /^HERDR_(PANE_ID|TAB_ID|WORKSPACE_ID|PLUGIN_(CONTEXT_JSON|EVENT|EVENT_JSON|ACTION_ID|ENTRYPOINT_ID|CLICKED_URL|LINK_HANDLER_ID))$/;

/** Start `serve --follow-herdr` in the background, appending its output to `logFile`. */
export function startDetached(logFile: string, env: NodeJS.ProcessEnv = process.env): number {
  mkdirSync(dirname(logFile), { recursive: true });
  const log = openSync(logFile, "a");
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !INVOCATION_ENV.test(key)));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../cli.ts", import.meta.url)), "serve", "--follow-herdr"], {
    detached: true,
    stdio: ["ignore", log, log],
    env: childEnv,
  });
  child.unref();
  closeSync(log);
  if (child.pid === undefined) throw new Error("failed to start the host");
  return child.pid;
}

/** SIGTERM the running host and wait for it to exit. Returns false if none was running. */
export async function stopRunningHost(configPath: string, timeoutMs = 5000): Promise<boolean> {
  const host = readRunningHost(configPath);
  if (!host) return false;
  process.kill(host.pid, "SIGTERM");
  const deadline = Date.now() + timeoutMs;
  while (isAlive(host.pid)) {
    if (Date.now() > deadline) throw new Error(`the host (pid ${host.pid}) didn't stop within ${timeoutMs / 1000}s`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}
