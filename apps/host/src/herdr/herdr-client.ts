import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HerdrPushedEvent, HerdrResponse } from "@shepherd/protocol";

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

export type Subscription = { close: () => void; closed: Promise<void> };

/**
 * Client for herdr's newline-delimited JSON socket API.
 *
 * herdr answers one request per connection and then closes it, so every
 * request opens its own connection. Subscriptions keep theirs open.
 */
export class HerdrClient {
  readonly socketPath: string;
  private readonly timeoutMs: number;
  private open = new Set<Socket>();
  private nextId = 0;

  constructor(socketPath: string = defaultSocketPath(), timeoutMs = 15_000) {
    this.socketPath = socketPath;
    this.timeoutMs = timeoutMs;
  }

  request<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    { timeoutMs = this.timeoutMs }: { timeoutMs?: number } = {},
  ): Promise<T> {
    const id = `shepherd:${++this.nextId}`;
    return new Promise<T>((resolve, reject) => {
      const conn = createConnection(this.socketPath);
      this.open.add(conn);
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.open.delete(conn);
        conn.destroy();
        fn();
      };
      const timer = setTimeout(
        () => settle(() => reject(new HerdrRequestError("timeout", `herdr ${method} timed out after ${timeoutMs}ms`))),
        timeoutMs,
      );

      conn.on("connect", () => conn.write(JSON.stringify({ id, method, params }) + "\n"));
      conn.on(
        "data",
        lineReader((line) => {
          let msg: HerdrResponse;
          try {
            msg = JSON.parse(line);
          } catch {
            return;
          }
          if (msg.id !== id) return;
          if ("error" in msg) settle(() => reject(new HerdrRequestError(msg.error.code, msg.error.message)));
          else settle(() => resolve(msg.result as T));
        }),
      );
      conn.on("error", (err) => settle(() => reject(err)));
      conn.on("close", () => settle(() => reject(new HerdrRequestError("disconnected", `herdr closed the connection during ${method}`))));
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
        conn.write(JSON.stringify({ id: "shepherd:sub", method: "events.subscribe", params: { subscriptions } }) + "\n");
      });
    });
  }

  /** Abort in-flight requests. Subscriptions are closed through their own handles. */
  close(): void {
    for (const conn of this.open) conn.destroy();
    this.open.clear();
  }
}
