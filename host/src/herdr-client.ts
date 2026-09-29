import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HerdrPushedEvent, HerdrResponse } from "@sheperd/protocol";

export function defaultSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HERDR_SOCKET_PATH) return env.HERDR_SOCKET_PATH;
  const configHome = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  if (env.HERDR_SESSION) return join(configHome, "herdr", "sessions", env.HERDR_SESSION, "herdr.sock");
  return join(configHome, "herdr", "herdr.sock");
}

export class HerdrRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HerdrRequestError";
    this.code = code;
  }
}

/** Splits a byte stream into newline-delimited JSON values. */
export function lineReader(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.toString();
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) onLine(line);
    }
  };
}

type Pending = { resolve: (result: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout };

export type Subscription = { close: () => void; closed: Promise<void> };

/**
 * Client for herdr's newline-delimited JSON socket API.
 *
 * Requests share one connection. Each `subscribe` opens its own connection,
 * since herdr keeps a subscribed connection open for pushed events only.
 */
export class HerdrClient {
  readonly socketPath: string;
  private conn: Socket | null = null;
  private connecting: Promise<Socket> | null = null;
  private pending = new Map<string, Pending>();
  private nextId = 0;
  private readonly timeoutMs: number;

  constructor(socketPath: string = defaultSocketPath(), timeoutMs = 15_000) {
    this.socketPath = socketPath;
    this.timeoutMs = timeoutMs;
  }

  async request<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const conn = await this.connection();
    const id = `sheperd:${++this.nextId}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HerdrRequestError("timeout", `herdr ${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (r: unknown) => void, reject, timer });
      conn.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  /**
   * Open a long-lived `events.subscribe` stream. Resolves once herdr
   * acknowledges the subscription, so callers can snapshot state afterwards
   * without missing events.
   */
  subscribe(subscriptions: Record<string, unknown>[], onEvent: (event: HerdrPushedEvent) => void): Promise<Subscription> {
    return new Promise((resolve, reject) => {
      const conn = createConnection(this.socketPath);
      let acknowledged = false;
      let resolveClosed!: () => void;
      const closed = new Promise<void>((r) => (resolveClosed = r));

      conn.on(
        "data",
        lineReader((line) => {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(line);
          } catch {
            return;
          }
          if (!acknowledged) {
            if ("error" in msg) {
              const err = msg.error as { code: string; message: string };
              conn.destroy();
              reject(new HerdrRequestError(err.code, err.message));
              return;
            }
            acknowledged = true;
            resolve({ close: () => conn.destroy(), closed });
            return;
          }
          if (typeof msg.event === "string") onEvent(msg as unknown as HerdrPushedEvent);
        }),
      );
      conn.on("error", (err) => {
        if (!acknowledged) reject(err);
      });
      conn.on("close", () => resolveClosed());
      conn.on("connect", () => {
        conn.write(JSON.stringify({ id: "sheperd:sub", method: "events.subscribe", params: { subscriptions } }) + "\n");
      });
    });
  }

  close(): void {
    this.conn?.destroy();
    this.conn = null;
  }

  private connection(): Promise<Socket> {
    if (this.conn && !this.conn.destroyed) return Promise.resolve(this.conn);
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<Socket>((resolve, reject) => {
      const conn = createConnection(this.socketPath);
      conn.on("data", lineReader((line) => this.handleLine(line)));
      conn.once("connect", () => {
        this.conn = conn;
        this.connecting = null;
        resolve(conn);
      });
      conn.on("error", (err) => {
        if (this.connecting) {
          this.connecting = null;
          reject(err);
        }
      });
      conn.on("close", () => {
        if (this.conn === conn) this.conn = null;
        this.failPending(new HerdrRequestError("disconnected", "herdr socket closed"));
      });
    });
    return this.connecting;
  }

  private handleLine(line: string): void {
    let msg: HerdrResponse;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    clearTimeout(pending.timer);
    if ("error" in msg) pending.reject(new HerdrRequestError(msg.error.code, msg.error.message));
    else pending.resolve(msg.result);
  }

  private failPending(err: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(id);
    }
  }
}
