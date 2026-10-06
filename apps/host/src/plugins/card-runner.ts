import { spawn } from "node:child_process";
import { CardFormatError, parseCardBody, type CardBody } from "@shepherd/protocol";

export type CardRun = { ok: true; body: CardBody | "hide" } | { ok: false; error: string };

export type RunOptions = { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number };
export type CardRunner = (command: string[], opts: RunOptions) => Promise<CardRun>;

const MAX_OUTPUT = 256 * 1024;
const STDERR_TAIL = 400;

const tail = (s: string, n: number) => (s.length > n ? "…" + s.slice(-n) : s).trim();

export const runCardCommand: CardRunner = (command, { cwd, env, timeoutMs }) =>
  new Promise((resolve) => {
    const [bin, ...args] = command;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let tooMuch = false;
    const done = (result: CardRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin!, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      return done({ ok: false, error: `Couldn't run ${bin}: ${(err as Error).message}` });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_OUTPUT) {
        tooMuch = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr = tail(stderr + chunk.toString("utf8"), 4096);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      done({ ok: false, error: err.code === "ENOENT" ? `Couldn't run ${bin}: not found. Is it installed?` : `Couldn't run ${bin}: ${err.message}` });
    });
    child.on("close", (code, signal) => {
      if (timedOut) return done({ ok: false, error: `The card command took longer than ${Math.round(timeoutMs / 1000)}s.` });
      if (tooMuch) return done({ ok: false, error: `The card command printed more than ${MAX_OUTPUT / 1024} KB.` });
      if (code !== 0) {
        const why = tail(stderr, STDERR_TAIL);
        return done({ ok: false, error: `The card command ${signal ? `was killed (${signal})` : `exited with code ${code}`}${why ? `: ${why}` : "."}` });
      }
      let raw: unknown;
      try {
        raw = JSON.parse(stdout);
      } catch {
        const shown = stdout.trim().slice(0, 100);
        return done({ ok: false, error: `The card command didn't print JSON${shown ? `: ${shown}${stdout.trim().length > 100 ? "…" : ""}` : " (nothing printed)"}.` });
      }
      try {
        done({ ok: true, body: parseCardBody(raw) });
      } catch (err) {
        done({ ok: false, error: err instanceof CardFormatError ? err.message : String(err) });
      }
    });
  });
