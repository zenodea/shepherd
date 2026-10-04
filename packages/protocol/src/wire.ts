// Messages between the app and the host, carried as JSON text frames over a
// WebSocket (directly on the LAN, or spliced through the relay).

import { AGENT_STATUSES, type AgentInfo, type AgentStatus } from "./herdr.ts";
import type { StyledLine } from "./palette.ts";

export const WIRE_PROTOCOL_VERSION = 3;

/** WebSocket close codes the host uses when it turns an app away. */
export const CLOSE_CODES = {
  /** Unknown token. */
  unauthorized: 4001,
  /** The pairing QR code is older than its time limit or was already used. */
  pairingExpired: 4002,
  /** This device was revoked on the host. */
  revoked: 4003,
  /** No `auth` message arrived in time. */
  authTimeout: 4004,
  /** The encryption handshake failed, or a frame failed to decrypt. */
  insecure: 4005,
} as const;

/**
 * Plaintext messages before the encrypted channel exists (see secure.ts).
 * Everything else travels as encrypted binary frames.
 */
export type HostHello = {
  type: "ready";
  protocol: number;
  /** Host static key (pinned by the app at pairing) and this connection's ephemeral key, hex. */
  e2e: { version: number; hostKey: string; ephemeral: string };
};
export type AppHandshake = { type: "handshake"; ephemeral: string };

const HEX_KEY = /^[0-9a-f]{64}$/;

export function parseHostHello(raw: string): HostHello | null {
  try {
    const m = JSON.parse(raw) as Partial<HostHello>;
    if (m?.type !== "ready" || typeof m.protocol !== "number" || !m.e2e) return null;
    const { version, hostKey, ephemeral } = m.e2e;
    if (typeof version !== "number" || !HEX_KEY.test(String(hostKey)) || !HEX_KEY.test(String(ephemeral))) return null;
    return { type: "ready", protocol: m.protocol, e2e: { version, hostKey, ephemeral } };
  } catch {
    return null;
  }
}

export function parseAppHandshake(raw: string): AppHandshake | null {
  try {
    const m = JSON.parse(raw) as Partial<AppHandshake>;
    return m?.type === "handshake" && HEX_KEY.test(String(m.ephemeral)) ? { type: "handshake", ephemeral: m.ephemeral! } : null;
  } catch {
    return null;
  }
}

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
  // Any tab, not just agents: scrollback history, keys, and a line of input.
  // Terminal control streams can already type into any pane, so these add no power.
  "pane.read",
  "pane.send_keys",
  "pane.send_input",
  // Managing what's open. Destructive, but no more than a control stream,
  // which can already type `exit` into any pane.
  "pane.close",
  "pane.rename",
  "workspace.rename",
] as const;
export type ForwardedMethod = (typeof FORWARDED_METHODS)[number];

/** Methods the host implements itself, with validated, narrow parameters. */
export const HOST_METHODS = [
  "shepherd.projects",
  "shepherd.start_agent",
  "shepherd.activity",
  "shepherd.conversation",
  "shepherd.changes",
  "shepherd.file_diff",
  "shepherd.image",
  "shepherd.images",
  "shepherd.subagents",
  "shepherd.upload",
  "shepherd.folders",
  "shepherd.model",
  "shepherd.set_model",
] as const;
export type HostMethod = (typeof HOST_METHODS)[number];
export type CallMethod = ForwardedMethod | HostMethod;

export type Project = {
  workspaceId: string;
  label: string;
  cwd: string | null;
  /** Set when the workspace is a git worktree herdr manages. */
  repoName: string | null;
};

/**
 * One of an agent's models or effort levels, named as the agent names it.
 * `id` picks it when the label alone isn't unique (else the label does);
 * `group` is e.g. its provider; `noEffort`: a model without effort levels.
 */
export type ModelChoice = { label: string; id?: string; detail?: string; group?: string; noEffort?: boolean };
export const choiceId = (choice: ModelChoice): string => choice.id ?? choice.label;
export type ModelParams = { paneId: string };
/** `model` is a `choiceId` from `models`, `effort` a label from `efforts`; null when unknown. */
export type ModelResult =
  | { available: true; agent: string; model: string | null; effort: string | null; models: ModelChoice[]; efforts: ModelChoice[] }
  | { available: false; reason: string };
/** Switches for this session only; at least one of the two. */
export type SetModelParams = { paneId: string; model?: string; effort?: string };

export type Folder = { name: string; path: string; /** A git repository. */ repo: boolean };

/** `path`: a folder to list (default: your home folder). Without one, suggestions come too. */
export type FoldersParams = { path?: string };
export type FoldersResult = {
  path: string;
  /** null at your home folder: browsing doesn't go above it. */
  parent: string | null;
  folders: Folder[];
  suggestions?: { recent: Folder[]; repos: Folder[] };
};

export type ProjectsResult = {
  /** Agent kinds herdr supports that are installed on the host. */
  kinds: string[];
  projects: Project[];
};

/** `kind` for a plain shell tab instead of an agent. */
export const TERMINAL_KIND = "terminal";

export type StartAgentParams = {
  /** An agent kind from `shepherd.projects`, or "terminal" for a plain shell. */
  kind: string;
  /** Where: an existing herdr workspace, or a folder for a new workspace (one of the two). */
  workspaceId?: string;
  folder?: string;
  /** Start in a new git worktree of the project instead of a new tab. */
  newWorktree?: boolean;
  /** Sent once the agent is ready for input; for a terminal, a command to run. */
  prompt?: string;
};

/** What happened to an agent: a status it moved to, or it appearing or closing. */
export type ActivityEvent = AgentStatus | "started" | "closed";

/** One line of the host's activity log. */
export type ActivityEntry = {
  /** Increasing; page backwards with `before`. */
  id: number;
  /** Unix ms. */
  at: number;
  event: ActivityEvent;
  previous: AgentStatus | null;
  paneId: string;
  workspaceId: string;
  /** Agent kind, e.g. "claude". */
  agent: string | null;
  name: string | null;
  /** What it's working on (its terminal title), if known. */
  title: string | null;
  cwd: string | null;
};

export type ActivityParams = { before?: number; limit?: number };
export type ActivityResult = { entries: ActivityEntry[] };

/**
 * One item of an agent's conversation, read from the transcript file its
 * harness (Claude Code, Codex, pi…) writes, rather than from its screen.
 * Ids increase through a session; a tool call's result is its own entry.
 */
/** An image in a conversation (one the agent read, or you sent). Its data is fetched separately, on demand. */
export type ImageRef = { id: string; mime: string; bytes: number };

export type ConversationEntry = { id: number; at?: string; images?: ImageRef[] } & (
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "thinking"; text: string }
  /** `diff`: for edits, exactly what this call changed. `subagent`: the id of the subagent this call started. */
  | { kind: "tool"; callId: string; name: string; summary: string; input?: string; diff?: FileDiff; subagent?: string }
  | { kind: "tool_result"; callId: string; ok: boolean; output: string }
  /** Something about the session itself, e.g. "Conversation compacted". */
  | { kind: "notice"; text: string }
);

/**
 * `after`: entries newer than this id (for polling). `before`: older ones (for
 * scrolling back). Neither: the latest `limit` entries.
 */
export type ConversationParams = { paneId: string; subagent?: string; after?: number; before?: number; limit?: number };

export type ConversationResult =
  | { available: false; reason: string }
  | {
      available: true;
      agent: string;
      /** Changes when the agent starts a new session (e.g. after /clear); start over then. */
      session: string;
      entries: ConversationEntry[];
      /** Oldest id the host has for this session, so the app knows when it has scrolled to the start. */
      first: number;
      /** Newest id so far. */
      last: number;
      /**
       * Messages waiting in the agent's own queue, oldest first, read from what
       * the agent records (Claude Code's transcript, Codex's queue). Absent for
       * agents that don't record theirs.
       */
      queued?: QueuedMessage[];
      /**
       * How much of the model's context the conversation fills, from the
       * latest usage the agent recorded. `window` is known only when the
       * agent records it (Codex).
       */
      context?: ContextUsage;
      /** Subagents this agent started, for agents that record them. */
      subagents?: Subagent[];
    };

export type ContextUsage = { used: number; window: number | null };

export type SubagentStatus = "running" | "done" | "stopped";

export type Subagent = {
  id: string;
  /** Its task, e.g. "Survey transcript formats" or "branch_review". */
  name: string;
  /** Its type or nickname, e.g. "Explore" or "Hypatia". */
  kind: string | null;
  /** 1 when started by the agent itself, 2 when started by one of its subagents… */
  depth: number;
  status: SubagentStatus;
  startedAt: string | null;
  updatedAt: string | null;
  toolCalls: number;
  /** Its latest step, e.g. "Read src/app.ts". */
  doing: string | null;
};

/** An image from the phone for an agent, in base64 chunks; the last one (`done`) saves it and returns its path. */
export type UploadParams = { uploadId: string; mime: string; data: string; done: boolean };
export type UploadResult = { received: number } | { path: string };

export type SubagentsParams = { paneId: string };
export type SubagentsResult = { available: false; reason: string } | { available: true; subagents: Subagent[] };

/** One line of a diff; line numbers are 1-based, in the old and new file. */
export type DiffLine = { kind: "add" | "del" | "ctx"; text: string; old?: number; new?: number };
export type DiffHunk = { oldStart: number; newStart: number; lines: DiffLine[] };
export type FileDiff = {
  path: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  /** Cut short: too big to send whole. */
  truncated?: boolean;
  binary?: boolean;
};

/** What "changes" means: not yet committed, or everything since the branch left the default branch. */
export type ChangesMode = "uncommitted" | "branch";

export type ChangedFile = {
  /** Relative to the repository. */
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  binary: boolean;
  /** Lock files and other generated output: shown, but folded away. */
  generated: boolean;
  /** How to refer to it in a message to the agent: relative to its folder. */
  mention: string;
};

export type ChangesParams = { paneId: string; mode?: ChangesMode };
export type ChangesResult =
  | { available: false; reason: string }
  | {
      available: true;
      mode: ChangesMode;
      /** Current branch, and the branch it's compared with in "branch" mode. */
      branch: string | null;
      base: string | null;
      /** Whether "branch" mode makes sense here (a branch other than the default one). */
      canCompareBranch: boolean;
      /** The first few hundred; `omitted` says how many more there are. Totals count them all. */
      files: ChangedFile[];
      omitted?: number;
      additions: number;
      deletions: number;
    };

/** One image's data, base64, in chunks: ask again `from` where the last one ended until `total`. */
export type ImageParams = { paneId: string; subagent?: string; id: string; from?: number };
export type ImageResult = { available: false; reason: string } | { available: true; mime: string; total: number; from: number; data: string };

/** Every image in a conversation, grouped under the message of yours they followed (null: before any), newest group first. */
export type ImageGroup = { message: string | null; at?: string; images: ImageRef[] };
export type ImagesParams = { paneId: string };
export type ImagesResult = { available: false; reason: string } | { available: true; session: string; groups: ImageGroup[] };

export type FileDiffParams = { paneId: string; path: string; mode: ChangesMode };
export type FileDiffResult = { available: false; reason: string } | { available: true; diff: FileDiff };

export type QueuedMessage = { text: string; at?: string };

export type StartAgentResult = {
  paneId: string;
  workspaceId: string;
  /** false when the agent is waiting on something (e.g. a trust prompt) first. */
  ready: boolean;
};

export type TerminalMode = "observe" | "control";
/**
 * "ansi": raw ANSI frames for an xterm view. "lines": the host runs a
 * terminal emulator and sends the screen as styled lines, for native views.
 */
export type TerminalRender = "ansi" | "lines";

export type DeviceInfo = { id: string; name: string };

export type ClientMessage =
  /**
   * Must be the first encrypted message. `token` is either this device's token or a
   * one-time pairing code from the host's QR code, which the host exchanges
   * for a device token (returned in `hello.credentials`).
   */
  | { type: "auth"; token: string; device: { name: string }; /** The app's WIRE_PROTOCOL_VERSION; absent from older apps. */ protocol?: number }
  | { type: "call"; id: string; method: CallMethod; params: Record<string, unknown> }
  /**
   * Without cols/rows the stream uses the pane's current size (nothing is
   * resized). A `control` stream with cols/rows resizes the pane for the phone;
   * the host restores the original size when the stream closes.
   */
  | { type: "terminal.open"; streamId: string; paneId: string; mode: TerminalMode; cols?: number; rows?: number; render?: TerminalRender }
  | { type: "terminal.input"; streamId: string; text: string }
  | { type: "terminal.input"; streamId: string; bytes: string }
  | { type: "terminal.resize"; streamId: string; cols: number; rows: number }
  | { type: "terminal.scroll"; streamId: string; direction: "up" | "down"; lines: number }
  | { type: "terminal.close"; streamId: string }
  | { type: "ping"; t: number };

export type HostInfo = {
  name: string;
  herdrVersion: string;
  /** Every address the host is currently reachable on; the app adopts these. */
  addresses?: string[];
};

export type ServerMessage =
  | {
      type: "hello";
      protocol: number;
      host: HostInfo;
      device: DeviceInfo;
      /** Present after pairing: the token this device should use from now on. */
      credentials?: { token: string };
      agents: AgentInfo[];
    }
  | { type: "auth.error"; code: "invalid" | "expired" | "revoked" | "version"; message: string }
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
  /** render "lines": the screen rows that changed (all of them when `full`). */
  | {
      type: "terminal.lines";
      streamId: string;
      width: number;
      height: number;
      cursor: { x: number; y: number; visible: boolean };
      lines: Record<string, StyledLine>;
      full: boolean;
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
    case "auth": {
      const { token, device, protocol } = msg;
      if (typeof token !== "string" || token.length === 0 || token.length > 256) return null;
      const name = isRecord(device) && typeof device.name === "string" ? device.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 64) : "";
      return { type: "auth", token, device: { name: name || "Unnamed device" }, ...(Number.isInteger(protocol) ? { protocol: protocol as number } : {}) };
    }
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
      if (msg.render !== undefined && msg.render !== "ansi" && msg.render !== "lines") return null;
      const extra: { render?: TerminalRender } = msg.render === "lines" ? { render: "lines" } : {};
      if (cols === undefined && rows === undefined) return { type: "terminal.open", streamId, paneId, mode, ...extra };
      if (!isDim(cols) || !isDim(rows)) return null;
      return { type: "terminal.open", streamId, paneId, mode, cols, rows, ...extra };
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
