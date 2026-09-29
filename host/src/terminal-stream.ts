import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type { HerdrTerminalCommand, HerdrTerminalRecord, TerminalMode } from "@sheperd/protocol";
import { isPaneId } from "@sheperd/protocol";
import { lineReader } from "./herdr-client.ts";

export type TerminalStreamOptions = {
  herdrBin: string;
  socketPath: string;
  paneId: string;
  mode: TerminalMode;
  cols: number;
  rows: number;
};

type Frame = Extract<HerdrTerminalRecord, { type: "terminal.frame" }>;

type StreamEvents = {
  frame: [Frame];
  closed: [string];
};

export type Spawner = (bin: string, args: string[], env: NodeJS.ProcessEnv) => ChildProcessWithoutNullStreams;

const defaultSpawner: Spawner = (bin, args, env) => spawn(bin, args, { env, stdio: ["pipe", "pipe", "pipe"] });

export function terminalSessionArgs({ paneId, mode, cols, rows }: Omit<TerminalStreamOptions, "herdrBin" | "socketPath">): string[] {
  if (!isPaneId(paneId)) throw new Error(`invalid pane id: ${paneId}`);
  const args = ["terminal", "session", mode, paneId, "--cols", String(cols), "--rows", String(rows)];
  // A controller must own input; take it from any stale owner (e.g. a phone
  // that dropped off without releasing).
  if (mode === "control") args.push("--takeover");
  return args;
}

/**
 * One `herdr terminal session observe|control` child process. herdr prints
 * newline-delimited `terminal.frame` records (the first is a full screen) and,
 * in control mode, reads JSON commands on stdin.
 */
export class TerminalStream extends EventEmitter<StreamEvents> {
  readonly mode: TerminalMode;
  private child: ChildProcessWithoutNullStreams;
  private closed = false;
  private stderr = "";

  constructor(opts: TerminalStreamOptions, spawner: Spawner = defaultSpawner) {
    super();
    this.mode = opts.mode;
    this.child = spawner(opts.herdrBin, terminalSessionArgs(opts), {
      ...process.env,
      HERDR_SOCKET_PATH: opts.socketPath,
    });
    this.child.stdout.on(
      "data",
      lineReader((line) => {
        let record: HerdrTerminalRecord;
        try {
          record = JSON.parse(line);
        } catch {
          return;
        }
        if (record.type === "terminal.frame") this.emit("frame", record);
        else if (record.type === "terminal.closed") this.finish(record.reason || "closed");
      }),
    );
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-2000);
    });
    this.child.stdin.on("error", () => {});
    this.child.on("error", (err) => this.finish(`failed to start herdr: ${err.message}`));
    this.child.on("exit", (code, signal) => {
      const detail = this.stderr.trim().split("\n").pop();
      this.finish(code === 0 || signal ? "exited" : `herdr exited with ${code}${detail ? `: ${detail}` : ""}`);
    });
  }

  send(command: HerdrTerminalCommand): boolean {
    if (this.closed || this.mode !== "control") return false;
    this.child.stdin.write(JSON.stringify(command) + "\n");
    return true;
  }

  close(): void {
    if (this.closed) return;
    if (this.mode === "control") {
      this.send({ type: "terminal.release" });
      this.child.stdin.end();
      setTimeout(() => this.child.kill(), 1000).unref();
    } else {
      this.child.kill();
    }
    this.finish("closed by client");
  }

  private finish(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("closed", reason);
  }
}
