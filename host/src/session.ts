import type { AgentInfo, ClientMessage, HostInfo, ServerMessage, StatusChange, TerminalMode } from "@sheperd/protocol";
import { WIRE_PROTOCOL_VERSION, parseClientMessage } from "@sheperd/protocol";
import type { AgentTracker } from "./agent-tracker.ts";
import { HerdrRequestError, type HerdrClient } from "./herdr-client.ts";
import type { TerminalStream } from "./terminal-stream.ts";

export const MAX_STREAMS_PER_SESSION = 8;

export type SessionDeps = {
  herdr: HerdrClient;
  tracker: AgentTracker;
  host: HostInfo;
  openTerminal: (paneId: string, mode: TerminalMode, cols: number, rows: number) => TerminalStream;
};

/**
 * One connected app. Transport-agnostic: the LAN server and the relay tunnel
 * both feed it text frames and give it a way to send them back.
 */
export class AppSession {
  private streams = new Map<string, TerminalStream>();
  private closed = false;
  private readonly send: (msg: ServerMessage) => void;
  private readonly deps: SessionDeps;
  private readonly onAgents = (agents: AgentInfo[]) => this.send({ type: "agents", agents });
  private readonly onStatus = (change: StatusChange) => this.send(change);

  constructor(send: (msg: ServerMessage) => void, deps: SessionDeps) {
    this.send = send;
    this.deps = deps;
    deps.tracker.on("agents", this.onAgents);
    deps.tracker.on("status", this.onStatus);
    this.send({ type: "hello", protocol: WIRE_PROTOCOL_VERSION, host: deps.host, agents: deps.tracker.list() });
  }

  async handle(raw: string): Promise<void> {
    if (this.closed) return;
    const msg = parseClientMessage(raw);
    if (!msg) {
      this.send({ type: "error", id: requestId(raw), error: { code: "invalid_message", message: "malformed or disallowed message" } });
      return;
    }
    await this.dispatch(msg);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.deps.tracker.off("agents", this.onAgents);
    this.deps.tracker.off("status", this.onStatus);
    for (const stream of this.streams.values()) stream.close();
    this.streams.clear();
  }

  private async dispatch(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "call":
        try {
          const result = await this.deps.herdr.request(msg.method, msg.params);
          this.send({ type: "result", id: msg.id, result });
        } catch (err) {
          const code = err instanceof HerdrRequestError ? err.code : "internal";
          const message = err instanceof Error ? err.message : String(err);
          this.send({ type: "error", id: msg.id, error: { code, message } });
        }
        return;

      case "terminal.open":
        this.openStream(msg.streamId, msg.paneId, msg.mode, msg.cols, msg.rows);
        return;

      case "terminal.input": {
        const stream = this.streams.get(msg.streamId);
        const ok = stream?.send("text" in msg ? { type: "terminal.input", text: msg.text } : { type: "terminal.input", bytes: msg.bytes });
        if (!ok) this.streamError(msg.streamId, "stream is not open in control mode");
        return;
      }

      case "terminal.resize": {
        const ok = this.streams.get(msg.streamId)?.send({ type: "terminal.resize", cols: msg.cols, rows: msg.rows });
        if (!ok) this.streamError(msg.streamId, "stream is not open in control mode");
        return;
      }

      case "terminal.scroll": {
        const ok = this.streams
          .get(msg.streamId)
          ?.send({ type: "terminal.scroll", direction: msg.direction, lines: msg.lines });
        if (!ok) this.streamError(msg.streamId, "stream is not open in control mode");
        return;
      }

      case "terminal.close":
        this.streams.get(msg.streamId)?.close();
        return;

      case "ping":
        this.send({ type: "pong", t: msg.t });
        return;
    }
  }

  private openStream(streamId: string, paneId: string, mode: TerminalMode, cols: number, rows: number): void {
    if (this.streams.has(streamId)) {
      this.streamError(streamId, "stream id already in use");
      return;
    }
    if (this.streams.size >= MAX_STREAMS_PER_SESSION) {
      this.send({ type: "terminal.closed", streamId, reason: `too many open terminals (max ${MAX_STREAMS_PER_SESSION})` });
      return;
    }
    const stream = this.deps.openTerminal(paneId, mode, cols, rows);
    this.streams.set(streamId, stream);
    stream.on("frame", (frame) => {
      if (this.closed) return;
      this.send({
        type: "terminal.frame",
        streamId,
        seq: frame.seq,
        full: frame.full,
        width: frame.width,
        height: frame.height,
        bytes: frame.bytes,
      });
    });
    stream.on("closed", (reason) => {
      this.streams.delete(streamId);
      if (!this.closed) this.send({ type: "terminal.closed", streamId, reason });
    });
  }

  private streamError(streamId: string, message: string): void {
    this.send({ type: "error", id: null, error: { code: "stream", message: `${streamId}: ${message}` } });
  }
}

function requestId(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { id?: unknown };
    return typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    return null;
  }
}
