import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { AgentInfo, AgentStatus, BlockedOn, HerdrPushedEvent, PaneReadResult, ReadSource, WorkspaceInfo } from "@shepherd/protocol";
import { HerdrRequestError, lineReader, type Subscription } from "../herdr/herdr-client.ts";

const TERMINAL = "com.superlogical.terminal";
/** Rex's own names for windows and panes it labelled itself, which say less than a number. */
const DEFAULT_WINDOW_LABEL = /^Window [0-9a-f]{8}$/;
const DEFAULT_BLOCK_LABEL = "shell";
/** A scan is a few `rex` calls per pane; requests close together share one. */
const WORLD_TTL_MS = 300;
const SCAN_CONCURRENCY = 8;
/** `rex events` prints nothing until something happens, so it counts as listening once it has run this long. */
const EVENTS_READY_MS = 300;
const PASTE_SETTLE_MS = 100;
const MAX_READ_LINES = 5000;
const KEY = /^[A-Za-z0-9+_[\]-]{1,32}$/;
const MAX_STATUS_TEXT = 200;
/** Characters of copied text sent on to the phone. */
const MAX_COPY = 16_000;

/** What each program calls itself, to the agent kind Shepherd knows it as. */
const KINDS: Record<string, string> = {
  claude: "claude",
  "claude-code": "claude",
  codex: "codex",
  opencode: "opencode",
  gemini: "gemini",
  pi: "pi",
  hermes: "hermes",
  amp: "amp",
  "cursor-agent": "cursor",
  copilot: "copilot",
};
/** Agents the phone can start, each typed into a new shell by the same name. */
const STARTABLE = ["claude", "codex", "opencode", "gemini", "pi", "hermes", "amp", "copilot"];
const WAIT_POLL_MS = 500;
const UNREPORTED_READY_MS = 5000;

/** A layout of one shell, in `cwd` when given. */
const shellIn = (cwd: unknown) => ({
  block: { flavor: `${TERMINAL}.shell`, ...(typeof cwd === "string" && cwd ? { options: { cwd } } : {}) },
});

/** Where Rex's own server listens: REX_SERVER (a unix:// URL) or the app's default socket. */
export function defaultRexServer(env: NodeJS.ProcessEnv = process.env): string {
  if (env.REX_SERVER) return env.REX_SERVER.startsWith("unix://") ? decodeURIComponent(env.REX_SERVER.slice("unix://".length)) : env.REX_SERVER;
  return join(env.HOME || homedir(), "Library", "Application Support", "rex", "server.sock");
}

export function rexAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.REX_SERVER) || existsSync(defaultRexServer(env));
}

/** Runs `rex ARGS…` and resolves with what it printed. */
export type RexRunner = (args: string[], timeoutMs: number) => Promise<string>;
/** Starts `rex events --all --json`, calling `onLine` for each event. */
export type RexEventSource = (onLine: (line: string) => void, onExit: (detail: string) => void) => { close: () => void };

type Proc = { pid?: number; name?: string; path?: string; invoked_path?: string; argv0?: string; cwd?: string };
type StatusRecord = { id?: string; state?: string; app?: string; effective_app?: string; msg?: string; kind?: string; owner?: { pid: number; name: string } | null };
type ViewBlock = { block_id: string; label?: string; creator_name?: string; placement?: string };
type View = {
  revision: number;
  session_id: string;
  label: string;
  active_window_id?: string;
  windows?: { window_id: string; label?: string; focused_block_id?: string; layers?: { blocks?: ViewBlock[] }[] }[];
};

export type RexPane = {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  label: string | null;
  title: string | null;
  cwd: string | null;
  focused: boolean;
  agent: string | null;
  status: AgentStatus;
  /** What the agent last said it's doing, and for a blocked one, what it waits for. */
  statusText: string | null;
  blockedOn: BlockedOn | null;
  /** In no window: started from the phone and not yet placed on the desktop. */
  hidden: boolean;
};
type RexTab = { tab_id: string; workspace_id: string; number: number; label: string; focused: boolean };
type RexWorkspace = { workspace_id: string; number: number; label: string; active_tab_id: string; revision: number };
export type RexWorld = { workspaces: RexWorkspace[]; tabs: RexTab[]; panes: RexPane[] };

/** Rex's program states, as herdr's agent statuses. */
export function statusOf(state: string | undefined): AgentStatus {
  if (state === "working" || state === "blocked" || state === "done" || state === "idle") return state;
  return state === "error" ? "idle" : "unknown";
}

/** The agent running in a pane: by the program's name, or the status it reports itself. */
export function kindOf(proc: Proc | null | undefined, records: StatusRecord[]): string | null {
  const names = [proc?.argv0?.replace(/^-/, ""), proc?.invoked_path, proc?.path, proc?.name].filter((n): n is string => Boolean(n)).map((n) => basename(n));
  for (const name of names) if (KINDS[name]) return KINDS[name]!;
  // A record outlives its program; only trust one the program in front reported.
  for (const r of records) {
    if (proc?.pid !== undefined && r.owner?.pid !== proc.pid) continue;
    const kind = KINDS[r.effective_app ?? r.app ?? ""];
    if (kind) return kind;
  }
  return null;
}

/** What a blocked program says it waits for; a value Rex adds later counts as unsaid. */
export function blockedOn(kind: string | undefined): BlockedOn | null {
  return kind === "permission" || kind === "question" || kind === "auth" ? kind : null;
}

/** A program's own status record, as the fields of herdr's status event and Shepherd's additions. */
function statusFields(record: StatusRecord): { agent_status: AgentStatus; status_text: string | null; blocked_on: BlockedOn | null } {
  const agent_status = statusOf(record.state);
  const text = record.msg?.trim();
  return { agent_status, status_text: text ? text.slice(0, MAX_STATUS_TEXT) : null, blocked_on: agent_status === "blocked" ? blockedOn(record.kind) : null };
}

const rank: Record<AgentStatus, number> = { blocked: 4, working: 3, done: 2, idle: 1, unknown: 0 };

/** Lines of output, the last `count` of them when given. */
function lastLines(content: string, count: number | null): { text: string; truncated: boolean } {
  const lines = content.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  if (count === null || lines.length <= count) return { text: lines.join("\n"), truncated: false };
  return { text: lines.slice(-count).join("\n"), truncated: true };
}

const defaultRunner =
  (bin: string): RexRunner =>
  (args, timeoutMs) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, ["--autostart=false", `--timeout=${Math.ceil(timeoutMs / 1000)}s`, ...args], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => child.kill(), timeoutMs + 1000);
      child.stdout.on("data", (c: Buffer) => (out += c.toString()));
      child.stderr.on("data", (c: Buffer) => (err = (err + c.toString()).slice(-2000)));
      child.on("error", (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(new HerdrRequestError("disconnected", e.code === "ENOENT" ? `Couldn't run ${bin}: not found. Is Rex installed?` : e.message));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) return resolve(out);
        reject(rexError(err.trim().split("\n").pop() || `rex exited with ${code}`));
      });
    });

/** `Error: … (status=404 code=session_not_found)` as a request error with that code. */
export function rexError(line: string): HerdrRequestError {
  const message = line.replace(/^Error:\s*/, "");
  const code = /\bcode=([a-z_]+)/.exec(message)?.[1] ?? (/connect|no such file|refused/i.test(message) ? "disconnected" : "rex_error");
  return new HerdrRequestError(code, message);
}

const defaultEvents =
  (bin: string): RexEventSource =>
  (onLine, onExit) => {
    const child: ChildProcess = spawn(bin, ["--autostart=false", "events", "--all", "--json"], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stdout!.on("data", lineReader(onLine));
    child.stderr!.on("data", (c: Buffer) => (err = (err + c.toString()).slice(-2000)));
    child.on("error", (e) => onExit(e.message));
    child.on("close", () => onExit(err.trim().split("\n").pop() || "rex events stopped"));
    return { close: () => child.kill() };
  };

/** Rex's events, as the herdr events the tracker subscribes to. */
export function translateEvent(raw: Record<string, unknown>): HerdrPushedEvent[] {
  const payload = (raw.payload ?? {}) as Record<string, unknown>;
  if (raw.type === "session_created" || raw.type === "session_destroyed") return [{ event: "pane.updated", data: {} }];
  if (raw.type !== "session_event") return [];
  const workspace_id = payload.session_id as string;
  const inner = (payload.event ?? {}) as { type?: string; payload?: Record<string, unknown> };
  const data = inner.payload ?? {};
  const pane_id = data.block_id as string | undefined;
  switch (inner.type) {
    case "block_created":
      return [{ event: "pane.created", data: { pane_id, workspace_id } }];
    case "block_closed":
      return [{ event: "pane.closed", data: { pane_id, workspace_id } }];
    case "window_created":
    case "window_closed":
      return [{ event: "pane.updated", data: { workspace_id } }];
    case "block_event": {
      if (data.creator_name !== TERMINAL) return [];
      const event = (data.payload ?? {}) as { id?: string; record?: StatusRecord; text?: string; bytes?: number };
      switch (data.name) {
        case "process_changed":
          return [{ event: "pane.agent_detected", data: { pane_id, workspace_id } }];
        case "child_exited":
          return [{ event: "pane.exited", data: { pane_id, workspace_id } }];
        case "program_status_changed":
          // Only the program's own status, not the tasks it reports under it.
          if (event.id || !event.record) return [];
          return [{ event: "pane.agent_status_changed", data: { pane_id, workspace_id, ...statusFields(event.record) } }];
        case "clipboard_written": {
          // Rex leaves the text out of an event when it's too long for one.
          if (typeof event.text !== "string" || !event.text) return [];
          const text = event.text.slice(0, MAX_COPY);
          const truncated = text.length < event.text.length || (typeof event.bytes === "number" && event.bytes > Buffer.byteLength(event.text));
          return [{ event: "pane.clipboard_written", data: { pane_id, workspace_id, text, truncated } }];
        }
        case "program_status_removed":
          return [{ event: "pane.updated", data: { pane_id, workspace_id } }];
      }
      return [];
    }
  }
  return inner.type?.endsWith("label_changed") ? [{ event: "pane.updated", data: { workspace_id } }] : [];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Rex, answering the herdr methods the host and the phone use. A Rex session
 * is a herdr workspace, a window a tab, and a terminal block a pane, so ids
 * are Rex's own. It talks to Rex through the `rex` command, its public API.
 */
export class RexClient {
  readonly socketPath: string;
  private readonly timeoutMs: number;
  private readonly run: RexRunner;
  private readonly events: RexEventSource;
  private world: { at: number; value: Promise<RexWorld> } | null = null;

  constructor(opts: { bin?: string; server?: string; timeoutMs?: number; run?: RexRunner; events?: RexEventSource } = {}) {
    const bin = opts.bin ?? "rex";
    this.socketPath = opts.server ?? defaultRexServer();
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.run = opts.run ?? defaultRunner(bin);
    this.events = opts.events ?? defaultEvents(bin);
  }

  async request<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    { timeoutMs = this.timeoutMs }: { timeoutMs?: number } = {},
  ): Promise<T> {
    return (await this.handle(method, params, timeoutMs)) as T;
  }

  subscribe(subscriptions: Record<string, unknown>[], onEvent: (event: HerdrPushedEvent) => void): Promise<Subscription> {
    return new Promise((resolve, reject) => {
      let started = false;
      let resolveClosed!: () => void;
      const closed = new Promise<void>((r) => (resolveClosed = r));
      const wanted = (e: HerdrPushedEvent) => subscriptions.some((s) => s.type === e.event && (s.pane_id === undefined || s.pane_id === e.data.pane_id));
      const source = this.events(
        (line) => {
          let raw: Record<string, unknown>;
          try {
            raw = JSON.parse(line);
          } catch {
            return;
          }
          const translated = translateEvent(raw);
          // Anything that changes what's open, or an agent's status, makes the last scan stale.
          if (translated.length) this.world = null;
          if (started) for (const e of translated) if (wanted(e)) onEvent(e);
        },
        (detail) => {
          clearTimeout(timer);
          if (!started) reject(rexError(detail));
          started = true;
          resolveClosed();
        },
      );
      const timer = setTimeout(() => {
        started = true;
        resolve({ close: () => source.close(), closed });
      }, EVENTS_READY_MS);
    });
  }

  close(): void {
    this.world = null;
  }

  /** Every session's windows and terminal panes, with what runs in each. */
  scan(): Promise<RexWorld> {
    if (this.world && Date.now() - this.world.at < WORLD_TTL_MS) return this.world.value;
    const value = this.doScan();
    const entry = { at: Date.now(), value };
    this.world = entry;
    value.catch(() => {
      if (this.world === entry) this.world = null;
    });
    return value;
  }

  private async doScan(): Promise<RexWorld> {
    const { sessions } = await this.api<{ sessions: { session_id: string; label: string }[] | null }>("session.list", {});
    const views = await mapLimit(sessions ?? [], SCAN_CONCURRENCY, async (s) => {
      const [view, all] = await Promise.all([
        this.api<View>("session.view", { session_id: s.session_id }),
        // A view shows only placed blocks; this also lists the ones in no window.
        this.api<{ blocks: ViewBlock[] | null }>("session.list_blocks", { session_id: s.session_id }).catch(() => ({ blocks: [] })),
      ]).catch(() => [null, null] as const);
      return view && { view, detached: (all?.blocks ?? []).filter((b) => b.placement !== "placed") };
    });
    const world: RexWorld = { workspaces: [], tabs: [], panes: [] };
    const blocks: { view: View; window: NonNullable<View["windows"]>[number] | null; block: ViewBlock }[] = [];
    views.forEach((found, i) => {
      if (!found) return;
      const { view, detached } = found;
      for (const block of detached) if (block.creator_name === TERMINAL) blocks.push({ view, window: null, block });
      world.workspaces.push({ workspace_id: view.session_id, number: i + 1, label: view.label, active_tab_id: view.active_window_id ?? "", revision: view.revision });
      (view.windows ?? []).forEach((window, w) => {
        const number = w + 1;
        world.tabs.push({
          tab_id: window.window_id,
          workspace_id: view.session_id,
          number,
          label: window.label && !DEFAULT_WINDOW_LABEL.test(window.label) ? window.label : String(number),
          focused: window.window_id === view.active_window_id,
        });
        for (const layer of window.layers ?? []) for (const block of layer.blocks ?? []) if (block.creator_name === TERMINAL) blocks.push({ view, window, block });
      });
    });
    world.panes = await mapLimit(blocks, SCAN_CONCURRENCY, async ({ view, window, block }): Promise<RexPane> => {
      const at = { session_id: view.session_id, block_id: block.block_id };
      const [process, status, title] = await Promise.all([
        this.api<{ foreground?: Proc | null }>("block.method", { ...at, method: "process" }).catch(() => null),
        this.api<{ records?: StatusRecord[] }>("block.method", { ...at, method: "program_status" }).catch(() => null),
        this.api<{ title?: string }>("block.method", { ...at, method: "title" }).catch(() => null),
      ]);
      const records = status?.records ?? [];
      const agent = kindOf(process?.foreground, records);
      const own = records.find((r) => !r.id) ?? records.find((r) => r.owner?.pid === process?.foreground?.pid);
      const fields = agent && own ? statusFields(own) : null;
      return {
        pane_id: block.block_id,
        tab_id: window?.window_id ?? "",
        workspace_id: view.session_id,
        label: block.label && block.label !== DEFAULT_BLOCK_LABEL ? block.label : null,
        title: title?.title || null,
        cwd: process?.foreground?.cwd ?? null,
        focused: window !== null && window.window_id === view.active_window_id && window.focused_block_id === block.block_id,
        agent,
        status: fields?.agent_status ?? "unknown",
        statusText: fields?.status_text ?? null,
        blockedOn: fields?.blocked_on ?? null,
        hidden: window === null,
      };
    });
    return world;
  }

  private async handle(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    switch (method) {
      case "ping": {
        const v = await this.api<{ rex_version: string }>("server.version", {}, timeoutMs);
        return { type: "pong", version: `rex ${v.rex_version}` };
      }
      case "agent.list":
        return { type: "agent_list", agents: this.agents(await this.scan()) };
      case "agent.get": {
        const pane = await this.pane(params.target);
        const agent = this.agents(await this.scan()).find((a) => a.pane_id === pane.pane_id);
        if (!agent) throw new HerdrRequestError("agent_not_found", "No agent runs in that pane");
        return { type: "agent", agent };
      }
      case "workspace.list":
        return { type: "workspace_list", workspaces: this.workspaces(await this.scan()) };
      case "tab.list": {
        const { tabs } = await this.scan();
        return { type: "tab_list", tabs: params.workspace_id ? tabs.filter((t) => t.workspace_id === params.workspace_id) : tabs };
      }
      case "session.snapshot": {
        const world = await this.scan();
        return {
          type: "session_snapshot",
          snapshot: {
            workspaces: world.workspaces.map((w) => ({ workspace_id: w.workspace_id, label: w.label })),
            tabs: world.tabs.map(({ focused: _, ...t }) => t),
            panes: world.panes.map((p) => ({
              pane_id: p.pane_id,
              tab_id: p.tab_id,
              workspace_id: p.workspace_id,
              focused: p.focused,
              label: p.label,
              title: p.title,
              terminal_title_stripped: p.title,
              cwd: p.cwd,
            })),
          },
        };
      }
      case "agent.read":
        return this.read(await this.pane(params.target), params, timeoutMs);
      case "pane.read":
        return this.read(await this.pane(params.pane_id), params, timeoutMs);
      case "agent.prompt": {
        const pane = await this.pane(params.target);
        if (typeof params.text !== "string") throw new HerdrRequestError("invalid_params", "agent.prompt needs text");
        // A paste, so a prompt with several lines arrives whole, then Enter to send it.
        await this.event(pane, { type: "paste", payload: { text: params.text } });
        await new Promise((r) => setTimeout(r, PASTE_SETTLE_MS));
        await this.keys(pane, ["enter"]);
        return { type: "ok" };
      }
      case "pane.send_input": {
        const pane = await this.pane(params.pane_id);
        if (typeof params.text === "string" && params.text) await this.blockMethod(pane, "write", { data: params.text });
        await this.keys(pane, params.keys);
        return { type: "ok" };
      }
      case "agent.send_keys":
        await this.keys(await this.pane(params.target), params.keys);
        return { type: "ok" };
      case "pane.send_keys":
        await this.keys(await this.pane(params.pane_id), params.keys);
        return { type: "ok" };
      case "agent.rename":
      case "pane.rename": {
        const pane = await this.pane(method === "agent.rename" ? params.target : params.pane_id);
        const label = method === "agent.rename" ? params.name : params.label;
        if (typeof label !== "string") throw new HerdrRequestError("invalid_params", `${method} needs a name`);
        await this.api("session.set_block_label", { session_id: pane.workspace_id, block_id: pane.pane_id, label });
        this.world = null;
        return { type: "ok" };
      }
      case "workspace.rename": {
        const workspace = (await this.scan()).workspaces.find((w) => w.workspace_id === params.workspace_id);
        if (!workspace || typeof params.label !== "string") throw new HerdrRequestError("workspace_not_found", "That session no longer exists");
        await this.api("session.set_label", { session_id: workspace.workspace_id, label: params.label });
        this.world = null;
        return { type: "ok" };
      }
      case "pane.close": {
        const pane = await this.pane(params.pane_id);
        await this.api("block.close", { session_id: pane.workspace_id, block_id: pane.pane_id });
        this.world = null;
        return { type: "ok" };
      }
      case "agent.focus": {
        const pane = await this.pane(params.target);
        await this.api("session.focus_block", { session_id: pane.workspace_id, block_id: pane.pane_id });
        return { type: "ok" };
      }
      case "pane.layout": {
        const pane = await this.pane(params.pane_id);
        const size = await this.blockMethod<{ columns: number; rows: number }>(pane, "size", {});
        return { type: "pane_layout", layout: { panes: [{ pane_id: pane.pane_id, rect: { width: size.columns, height: size.rows } }] } };
      }

      // Starting agents (launcher.ts): a shell in a new session or window, then the agent typed into it.
      case "server.agent_manifests":
        return { type: "agent_manifests", manifests: STARTABLE.map((agent) => ({ agent })) };
      case "workspace.create": {
        if (params.hidden === true) {
          const { session_id } = await this.api<{ session_id: string }>("session.create", typeof params.label === "string" ? { label: params.label } : {});
          return { type: "workspace_created", root_pane: await this.hiddenShell(session_id, params.cwd) };
        }
        const created = await this.api<{ session_id: string; initial_windows: { window_id: string; block_ids: string[] }[] }>("session.create", {
          ...(typeof params.label === "string" ? { label: params.label } : {}),
          initial_windows: [{ layout: shellIn(params.cwd) }],
        });
        this.world = null;
        const window = created.initial_windows[0]!;
        return { type: "workspace_created", root_pane: { pane_id: window.block_ids[0]!, workspace_id: created.session_id, tab_id: window.window_id } };
      }
      case "tab.create": {
        if (typeof params.workspace_id !== "string") throw new HerdrRequestError("invalid_params", "tab.create needs a workspace_id");
        if (params.hidden === true) return { type: "tab_created", root_pane: await this.hiddenShell(params.workspace_id, params.cwd) };
        const created = await this.api<{ window_id: string; block_ids: string[] }>("session.new_window", {
          session_id: params.workspace_id,
          ...(typeof params.label === "string" ? { window_label: params.label } : {}),
          layout: shellIn(params.cwd),
          focus: params.focus === true,
        });
        this.world = null;
        return { type: "tab_created", root_pane: { pane_id: created.block_ids[0]!, workspace_id: params.workspace_id, tab_id: created.window_id } };
      }
      case "agent.start": {
        const pane = await this.pane(params.pane_id);
        if (typeof params.kind !== "string" || !STARTABLE.includes(params.kind)) throw new HerdrRequestError("invalid_params", "unknown agent kind");
        // A hidden agent's shell goes when the agent does, so nothing is left running out of sight.
        // Not `exec`: the agent would stay in login's process group, and Rex would report login in front.
        await this.blockMethod(pane, "write", { data: `${params.kind}${pane.hidden ? "; exit" : ""}\r` });
        // The launcher waits with agent.wait, then sends the first prompt.
        throw new HerdrRequestError("agent_not_ready", `${params.kind} is starting`);
      }
      case "agent.wait":
        return this.wait(params.target, params.until, typeof params.timeout_ms === "number" ? params.timeout_ms : 60_000);
      case "workspace.close":
        if (typeof params.workspace_id !== "string") throw new HerdrRequestError("invalid_params", "workspace.close needs a workspace_id");
        await this.api("session.destroy", { session_id: params.workspace_id });
        this.world = null;
        return { type: "ok" };
      case "tab.close": {
        const tab = (await this.scan()).tabs.find((t) => t.tab_id === params.tab_id);
        if (!tab) throw new HerdrRequestError("tab_not_found", "That window no longer exists");
        await this.api("session.close_window", { session_id: tab.workspace_id, window_id: tab.tab_id });
        this.world = null;
        return { type: "ok" };
      }
      case "pane.place": {
        const pane = await this.pane(params.pane_id);
        if (!pane.hidden) return { type: "ok" };
        await this.place(pane, typeof params.label === "string" ? params.label : undefined);
        return { type: "ok" };
      }
      case "worktree.create":
        throw new HerdrRequestError("unsupported", "New worktrees need herdr; with Rex, start the agent in a folder instead");
    }
    throw new HerdrRequestError("unsupported", `${method} isn't available with Rex yet`);
  }

  /** A shell in no window of the session, so it shows on the phone and not on the desktop. */
  private async hiddenShell(sessionId: string, cwd: unknown): Promise<{ pane_id: string; workspace_id: string; tab_id: string }> {
    const { block_id } = await this.api<{ block_id: string }>("session.new_block", { session_id: sessionId, ...shellIn(cwd).block });
    this.world = null;
    return { pane_id: block_id, workspace_id: sessionId, tab_id: "" };
  }

  /**
   * Put a hidden pane in a window of its own. A new window needs a block of its
   * own, so it opens with a stand-in shell that the pane then replaces.
   */
  private async place(pane: RexPane, label: string | undefined): Promise<void> {
    const at = { session_id: pane.workspace_id };
    const window = await this.api<{ block_ids: string[] }>("session.new_window", {
      ...at,
      focus: false,
      ...(label ? { window_label: label.slice(0, 128) } : {}),
      layout: shellIn(pane.cwd),
    });
    const standIn = window.block_ids[0]!;
    try {
      await this.api("session.move_block", { ...at, block_id: pane.pane_id, anchor_block_id: standIn });
    } finally {
      await this.api("block.close", { ...at, block_id: standIn }).catch(() => {});
      this.world = null;
    }
  }

  /** The pane's screen as escape sequences, its size, and where the cursor is. */
  async screen(paneId: string): Promise<{ lines: string[]; cursor: string; columns: number; rows: number }> {
    const pane = await this.pane(paneId);
    const [{ content }, size] = await Promise.all([
      this.blockMethod<{ content: string }>(pane, "format", { format: "vt", extra_cursor: true }),
      this.blockMethod<{ columns: number; rows: number }>(pane, "size", {}),
    ]);
    const cursor = /\x1b\[\d+;\d+H$/.exec(content)?.[0] ?? "";
    const lines = content.slice(0, content.length - cursor.length).replace(/\r\n$/, "").split("\r\n");
    return { lines: lines.slice(-size.rows), cursor, columns: size.columns, rows: size.rows };
  }

  /** Type into the pane: text, or the bytes of keys such as \x1b[A. */
  async input(paneId: string, data: string): Promise<void> {
    await this.blockMethod(await this.pane(paneId), "write", { data });
  }

  /** Ask for a size; Rex applies it only while no app owns the pane. */
  async resize(paneId: string, columns: number, rows: number): Promise<void> {
    await this.blockMethod(await this.pane(paneId), "resize", { columns, rows });
  }

  /** Until the agent in a pane reaches one of `until`, as herdr's agent.wait. */
  private async wait(target: unknown, until: unknown, timeoutMs: number): Promise<unknown> {
    const wanted = Array.isArray(until) ? (until as string[]) : ["idle"];
    const deadline = Date.now() + timeoutMs;
    let runningSince: number | null = null;
    for (;;) {
      const pane = await this.pane(target);
      if (pane.agent) runningSince ??= Date.now();
      // An agent that never reports its status counts as idle once it has had time to start.
      const status = pane.status === "unknown" && runningSince !== null && Date.now() - runningSince > UNREPORTED_READY_MS ? "idle" : pane.status;
      if (pane.agent && wanted.includes(status)) return { type: "agent_waited", status };
      if (Date.now() > deadline) throw new HerdrRequestError("timeout", "The agent didn't get ready in time");
      await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
      this.world = null;
    }
  }

  private agents(world: RexWorld): AgentInfo[] {
    const revision = new Map(world.workspaces.map((w) => [w.workspace_id, w.revision]));
    return world.panes
      .filter((p) => p.agent)
      .map((p) => ({
        agent: p.agent,
        name: p.label,
        title: p.title,
        agent_status: p.status,
        cwd: p.cwd,
        foreground_cwd: p.cwd,
        focused: p.focused,
        pane_id: p.pane_id,
        tab_id: p.tab_id,
        workspace_id: p.workspace_id,
        terminal_id: p.pane_id,
        terminal_title: p.title,
        terminal_title_stripped: p.title,
        revision: revision.get(p.workspace_id) ?? 0,
        status_text: p.statusText,
        blocked_on: p.blockedOn,
        hidden: p.hidden,
      }));
  }

  private workspaces(world: RexWorld): WorkspaceInfo[] {
    return world.workspaces.map((w) => {
      const panes = world.panes.filter((p) => p.workspace_id === w.workspace_id);
      const status = panes.filter((p) => p.agent).reduce<AgentStatus>((best, p) => (rank[p.status] > rank[best] ? p.status : best), "unknown");
      return {
        workspace_id: w.workspace_id,
        number: w.number,
        label: w.label,
        focused: false,
        agent_status: status === "unknown" ? "idle" : status,
        pane_count: panes.length,
        tab_count: world.tabs.filter((t) => t.workspace_id === w.workspace_id).length,
        active_tab_id: w.active_tab_id,
      };
    });
  }

  /** A pane by id, scanning again if it's new since the last scan. */
  private async pane(id: unknown): Promise<RexPane> {
    if (typeof id !== "string") throw new HerdrRequestError("invalid_params", "a pane id is required");
    let pane = (await this.scan()).panes.find((p) => p.pane_id === id);
    if (!pane) {
      this.world = null;
      pane = (await this.scan()).panes.find((p) => p.pane_id === id);
    }
    if (!pane) throw new HerdrRequestError("pane_not_found", `No pane ${id}`);
    return pane;
  }

  private async read(pane: RexPane, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const source = (typeof params.source === "string" ? params.source : "recent") as ReadSource;
    const format = params.format === "ansi" ? "ansi" : "text";
    const [{ content }, size] = await Promise.all([
      this.blockMethod<{ content: string }>(pane, "format", { format: format === "ansi" ? "vt" : "text", trim: format === "text", unwrap: source === "recent_unwrapped" }, timeoutMs),
      source === "visible" || source === "detection" ? this.blockMethod<{ rows: number }>(pane, "size", {}) : null,
    ]);
    const requested = typeof params.lines === "number" && params.lines > 0 ? Math.min(params.lines, MAX_READ_LINES) : MAX_READ_LINES;
    const { text, truncated } = lastLines(content, size ? size.rows : requested);
    const read: PaneReadResult = {
      pane_id: pane.pane_id,
      workspace_id: pane.workspace_id,
      tab_id: pane.tab_id,
      source,
      format,
      text,
      revision: 0,
      truncated,
    };
    return { type: "pane_read", read };
  }

  private async keys(pane: RexPane, keys: unknown): Promise<void> {
    if (keys === undefined) return;
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string" && KEY.test(k))) throw new HerdrRequestError("invalid_params", "keys must be key names such as enter or ctrl+c");
    if (keys.length === 0) return;
    await this.run(["send-key", "-s", pane.workspace_id, "-b", pane.pane_id, ...keys], this.timeoutMs);
  }

  private event(pane: RexPane, event: Record<string, unknown>): Promise<unknown> {
    return this.api("block.event", { session_id: pane.workspace_id, block_id: pane.pane_id, event });
  }

  private blockMethod<T>(pane: RexPane, method: string, args: Record<string, unknown>, timeoutMs = this.timeoutMs): Promise<T> {
    return this.api<T>("block.method", { session_id: pane.workspace_id, block_id: pane.pane_id, method, args }, timeoutMs);
  }

  private async api<T>(method: string, params: Record<string, unknown>, timeoutMs = this.timeoutMs): Promise<T> {
    const out = await this.run(["api", "call", method, JSON.stringify(params)], timeoutMs);
    try {
      return JSON.parse(out) as T;
    } catch {
      throw new HerdrRequestError("rex_error", `rex ${method} printed something that isn't JSON`);
    }
  }
}
