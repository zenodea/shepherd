// Messages between the app and the host, carried as JSON text frames over a
// WebSocket (directly on the LAN, or spliced through the relay).

import { AGENT_STATUSES, type AgentInfo, type AgentStatus } from "./herdr.ts";

export const WIRE_PROTOCOL_VERSION = 1;

/**
 * herdr methods the host will forward on behalf of the app. Anything not in
 * this list is rejected, so a leaked token can read and prompt agents but
 * cannot run arbitrary commands via `pane.run`, `plugin.*`, etc.
 */
export const FORWARDED_METHODS = [
  "agent.list",
  "agent.get",
  "agent.read",
  "agent.prompt",
  "agent.send_keys",
  "agent.rename",
  "agent.focus",
  "workspace.list",
  "tab.list",
  "session.snapshot",
] as const;
export type ForwardedMethod = (typeof FORWARDED_METHODS)[number];

/** Methods the host implements itself, with validated, narrow parameters. */
export const HOST_METHODS = ["sheperd.projects", "sheperd.start_agent"] as const;
export type HostMethod = (typeof HOST_METHODS)[number];
export type CallMethod = ForwardedMethod | HostMethod;

export type Project = {
  workspaceId: string;
  label: string;
  cwd: string | null;
  /** Set when the workspace is a git worktree herdr manages. */
  repoName: string | null;
};

export type ProjectsResult = {
  /** Agent kinds herdr supports that are installed on the host. */
  kinds: string[];
  projects: Project[];
};

export type StartAgentParams = {
  kind: string;
  workspaceId: string;
  /** Start in a new git worktree of the project instead of a new tab. */
  newWorktree?: boolean;
  /** Sent once the agent is ready for input. */
  prompt?: string;
};

export type StartAgentResult = {
  paneId: string;
  workspaceId: string;
  /** false when the agent is waiting on something (e.g. a trust prompt) first. */
  ready: boolean;
};

export type TerminalMode = "observe" | "control";

export type ClientMessage =
  | { type: "call"; id: string; method: CallMethod; params: Record<string, unknown> }
  /**
   * Without cols/rows the stream uses the pane's current size (nothing is
   * resized). A `control` stream with cols/rows resizes the pane for the phone;
   * the host restores the original size when the stream closes.
   */
  | { type: "terminal.open"; streamId: string; paneId: string; mode: TerminalMode; cols?: number; rows?: number }
  | { type: "terminal.input"; streamId: string; text: string }
  | { type: "terminal.input"; streamId: string; bytes: string }
  | { type: "terminal.resize"; streamId: string; cols: number; rows: number }
  | { type: "terminal.scroll"; streamId: string; direction: "up" | "down"; lines: number }
  | { type: "terminal.close"; streamId: string }
  | { type: "ping"; t: number };

export type HostInfo = {
  name: string;
  herdrVersion: string;
  /** ntfy subscribe link, when the host sends push notifications. */
  notifyUrl?: string;
};

export type ServerMessage =
  | { type: "hello"; protocol: number; host: HostInfo; agents: AgentInfo[] }
  | { type: "result"; id: string; result: unknown }
  | { type: "error"; id: string | null; error: { code: string; message: string } }
  | { type: "agents"; agents: AgentInfo[] }
  | { type: "agent.status"; paneId: string; status: AgentStatus; previous: AgentStatus | null; agent: AgentInfo | null }
  | {
      type: "terminal.frame";
      streamId: string;
      seq: number;
      full: boolean;
      width: number;
      height: number;
      /** base64-encoded ANSI bytes */
      bytes: string;
    }
  | { type: "terminal.closed"; streamId: string; reason: string }
  | { type: "pong"; t: number };

export type StatusChange = Extract<ServerMessage, { type: "agent.status" }>;

// herdr ids look like `w9:p2`; also rejects a leading `-` so an id can never be
// read as a CLI flag when passed to `herdr terminal session …`.
const PANE_ID = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$/;
const STREAM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TERMINAL_DIM = 1000;

export function isPaneId(value: unknown): value is string {
  return typeof value === "string" && PANE_ID.test(value);
}

export function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === "string" && (AGENT_STATUSES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStreamId(value: unknown): value is string {
  return typeof value === "string" && STREAM_ID.test(value);
}

function isDim(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= MAX_TERMINAL_DIM;
}

/** Validate an untrusted frame from the app. Returns null when malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(msg)) return null;

  switch (msg.type) {
    case "call": {
      const { id, method, params = {} } = msg;
      if (typeof id !== "string" || id.length === 0 || id.length > 128) return null;
      if (![...FORWARDED_METHODS, ...HOST_METHODS].includes(method as CallMethod)) return null;
      if (!isRecord(params)) return null;
      return { type: "call", id, method: method as CallMethod, params };
    }
    case "terminal.open": {
      const { streamId, paneId, mode, cols, rows } = msg;
      if (!isStreamId(streamId) || !isPaneId(paneId)) return null;
      if (mode !== "observe" && mode !== "control") return null;
      if (cols === undefined && rows === undefined) return { type: "terminal.open", streamId, paneId, mode };
      if (!isDim(cols) || !isDim(rows)) return null;
      return { type: "terminal.open", streamId, paneId, mode, cols, rows };
    }
    case "terminal.input": {
      const { streamId, text, bytes } = msg;
      if (!isStreamId(streamId)) return null;
      if (typeof text === "string" && bytes === undefined) return { type: "terminal.input", streamId, text };
      if (typeof bytes === "string" && text === undefined) return { type: "terminal.input", streamId, bytes };
      return null;
    }
    case "terminal.resize": {
      const { streamId, cols, rows } = msg;
      if (!isStreamId(streamId) || !isDim(cols) || !isDim(rows)) return null;
      return { type: "terminal.resize", streamId, cols, rows };
    }
    case "terminal.scroll": {
      const { streamId, direction, lines } = msg;
      if (!isStreamId(streamId) || (direction !== "up" && direction !== "down") || !isDim(lines)) return null;
      return { type: "terminal.scroll", streamId, direction, lines };
    }
    case "terminal.close": {
      const { streamId } = msg;
      if (!isStreamId(streamId)) return null;
      return { type: "terminal.close", streamId };
    }
    case "ping": {
      const { t } = msg;
      if (typeof t !== "number") return null;
      return { type: "ping", t };
    }
    default:
      return null;
  }
}
