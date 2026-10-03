// Subset of herdr's socket API (protocol 22) used by shepherd.
// Full schema: `herdr api schema --json`.

export const AGENT_STATUSES = ["idle", "working", "blocked", "done", "unknown"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export type AgentInfo = {
  agent?: string | null;
  display_agent?: string | null;
  name?: string | null;
  title?: string | null;
  agent_status: AgentStatus;
  cwd?: string | null;
  foreground_cwd?: string | null;
  focused: boolean;
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  terminal_id: string;
  terminal_title?: string | null;
  terminal_title_stripped?: string | null;
  revision: number;
  state_change_seq?: number;
  /** Reported by herdr's agent integrations: the agent's session, as an id or its transcript file. */
  agent_session?: { agent: string; kind: "id" | "path"; source: string; value: string } | null;
  /** Added by Shepherd's host, not herdr: when it last finished a turn (unix ms), from the activity log. */
  last_done_at?: number | null;
};

export type WorkspaceInfo = {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  agent_status: AgentStatus;
  pane_count: number;
  tab_count: number;
  active_tab_id: string;
};

export type ReadSource = "visible" | "recent" | "recent_unwrapped" | "detection";
export type ReadFormat = "text" | "ansi";

export type PaneReadResult = {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  source: ReadSource;
  format: ReadFormat;
  text: string;
  revision: number;
  truncated: boolean;
};

export type HerdrRequest = {
  id: string;
  method: string;
  params: Record<string, unknown>;
};

export type HerdrError = { code: string; message: string };

export type HerdrResponse =
  | { id: string; result: { type: string } & Record<string, unknown> }
  | { id: string; error: HerdrError };

/** Line pushed on a connection after `events.subscribe` is acknowledged. */
export type HerdrPushedEvent = {
  event: string;
  data: Record<string, unknown>;
};

export type PaneAgentStatusChanged = {
  pane_id: string;
  workspace_id: string;
  agent_status: AgentStatus;
  agent?: string | null;
  display_agent?: string | null;
  title?: string | null;
};

/** Record printed by `herdr terminal session observe|control`. */
export type HerdrTerminalRecord =
  | {
      type: "terminal.frame";
      seq: number;
      encoding: "ansi";
      width: number;
      height: number;
      full: boolean;
      /** base64-encoded ANSI bytes */
      bytes: string;
    }
  | { type: "terminal.closed"; reason: string };

/** Command accepted on stdin by `herdr terminal session control`. */
export type HerdrTerminalCommand =
  | { type: "terminal.input"; text: string }
  | { type: "terminal.input"; bytes: string }
  | { type: "terminal.resize"; cols: number; rows: number }
  | { type: "terminal.scroll"; direction: "up" | "down"; lines: number }
  | { type: "terminal.release" };
