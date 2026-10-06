import type {
  ActivityParams,
  AgentInfo,
  CallMethod,
  ClientMessage,
  HostInfo,
  KeyPair,
  ServerMessage,
  StartAgentParams,
  StatusChange,
  TerminalMode,
  TerminalRender,
} from "@shepherd/protocol";
import { CLOSE_CODES, WIRE_PROTOCOL_VERSION, isPaneId, parseClientMessage } from "@shepherd/protocol";
import { conversationParams, imageParams, type Conversations } from "../conversation/conversations.ts";
import { changes, changesParams, fileDiff, fileDiffParams } from "../changes/git-changes.ts";
import type { AgentTracker } from "../herdr/agent-tracker.ts";
import type { Device, DeviceRegistry } from "../pairing/devices.ts";
import { HerdrRequestError, type HerdrClient } from "../herdr/herdr-client.ts";
import type { ActivityLog } from "../herdr/activity-log.ts";
import type { SlashCommands } from "../commands/slash-commands.ts";
import type { RunningSubagents } from "../conversation/running-subagents.ts";
import type { Uploads } from "../uploads.ts";
import { ModelError, type Models } from "../model/models.ts";
import { ScreenError } from "../model/screen.ts";
import { LaunchError, type Launcher } from "../herdr/launcher.ts";
import { ScreenRenderer } from "../herdr/screen-renderer.ts";
import type { TerminalStream } from "../herdr/terminal-stream.ts";
import { hostCommand } from "../system/config.ts";

export const MAX_STREAMS_PER_SESSION = 8;
/** Used when herdr can't report a pane's size. */
const FALLBACK_SIZE = { cols: 120, rows: 40 };
const RESTORE_TIMEOUT_MS = 2000;
/**
 * History reads can take a while: for full-screen agents herdr scrolls the
 * agent to collect its transcript (up to 15s, plus up to 5s to scroll back).
 */
const READ_TIMEOUT_MS = 45_000;
export const AUTH_TIMEOUT_MS = 10_000;

type Size = { cols: number; rows: number };

export type SessionDeps = {
  herdr: HerdrClient;
  tracker: AgentTracker;
  host: HostInfo;
  /** This host's static key pair for end-to-end encryption. */
  hostKey: KeyPair;
  devices: DeviceRegistry;
  openTerminal: (paneId: string, mode: TerminalMode, cols: number, rows: number) => TerminalStream;
  /** Implements `shepherd.*` methods; without it they report unsupported. */
  launcher?: Launcher;
  /** Backs `shepherd.activity`; without it the feed is empty. */
  activity?: ActivityLog;
  /** Backs `shepherd.conversation`; without it there are no conversations. */
  conversations?: Conversations;
  /** Backs `shepherd.model` and `shepherd.set_model`; without them models can't be switched. */
  models?: Models;
  /** Backs `shepherd.upload`; without it images can't be sent. */
  uploads?: Uploads;
  /** Subagents still running for agents that aren't, shown in the agent list. */
  runningSubagents?: RunningSubagents;
  /** Backs `shepherd.commands`: the "/" commands to suggest. */
  commands?: SlashCommands;
  /** Told which phones are connected, for the Shepherd window. */
  presence?: { connected: (deviceId: string, via: "direct" | "relay") => () => void };
};

export type SessionTransport = {
  send: (msg: ServerMessage) => void;
  /** Close the underlying socket. */
  close: (code: number, reason: string) => void;
  /** How the phone reached the host. */
  via?: "direct" | "relay";
};

/**
 * One connected app. Transport-agnostic: the LAN server and the relay tunnel
 * both feed it text frames and give it a way to send them back.
 *
 * The first message must be `auth`. Until it succeeds nothing else is
 * accepted and nothing about the host is sent.
 */
export class AppSession {
  private streams = new Map<string, TerminalStream>();
  private opening = new Set<string>();
  private closed = false;
  private device: Device | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null;
  private releasePresence: (() => void) | null = null;
  private readonly transport: SessionTransport;
  private readonly deps: SessionDeps;
  private readonly onAgents = (agents: AgentInfo[]) => this.send({ type: "agents", agents: this.withHostInfo(agents) });
  private readonly onSubagents = () => this.onAgents(this.deps.tracker.list());
  private readonly onStatus = (change: StatusChange) => {
    this.send(change);
    // The list went out just before this change was logged: send it again with the new "last done".
    if (change.previous === "working" && (change.status === "done" || change.status === "idle")) this.onAgents(this.deps.tracker.list());
  };
  private readonly onDevicesChanged = () => {
    if (this.device && !this.deps.devices.get(this.device.id)) {
      this.reject("revoked", "This device was removed on the host. Scan a new pairing QR code.", CLOSE_CODES.revoked);
    }
  };

  constructor(transport: SessionTransport, deps: SessionDeps) {
    this.transport = transport;
    this.deps = deps;
    this.authTimer = setTimeout(() => this.transport.close(CLOSE_CODES.authTimeout, "authentication timed out"), AUTH_TIMEOUT_MS);
  }

  get deviceId(): string | null {
    return this.device?.id ?? null;
  }

  async handle(raw: string): Promise<void> {
    if (this.closed) return;
    const msg = parseClientMessage(raw);
    if (!this.device) {
      if (msg?.type !== "auth") this.reject("invalid", "authenticate first", CLOSE_CODES.unauthorized);
      // Apps from before the version was sent leave it out: let them in.
      else if (msg.protocol !== undefined && msg.protocol !== WIRE_PROTOCOL_VERSION) {
        const message =
          msg.protocol < WIRE_PROTOCOL_VERSION
            ? "Update the Shepherd app on your phone: this computer runs a newer Shepherd."
            : "Update Shepherd on your computer: the app on your phone is newer.";
        this.reject("version", message, CLOSE_CODES.unauthorized);
      } else this.authenticate(msg.token, msg.device.name);
      return;
    }
    if (!msg) {
      this.send({ type: "error", id: requestId(raw), error: { code: "invalid_message", message: "malformed or disallowed message" } });
      return;
    }
    if (msg.type === "auth") return;
    await this.dispatch(msg);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.authTimer) clearTimeout(this.authTimer);
    this.releasePresence?.();
    this.deps.tracker.off("agents", this.onAgents);
    this.deps.tracker.off("status", this.onStatus);
    this.deps.runningSubagents?.off("changed", this.onSubagents);
    this.deps.devices.off("changed", this.onDevicesChanged);
    for (const stream of [...this.streams.values()]) stream.close();
    this.streams.clear();
  }

  private send(msg: ServerMessage): void {
    if (!this.closed) this.transport.send(msg);
  }

  private authenticate(token: string, deviceName: string): void {
    const result = this.deps.devices.authenticate(token, deviceName);
    if (!result.ok) {
      if (result.reason === "expired") {
        this.reject("expired", `This pairing QR code has expired or was already used. Run \`${hostCommand("pair")}\` for a new one.`, CLOSE_CODES.pairingExpired);
      } else {
        this.reject("invalid", "This device isn't paired with the host.", CLOSE_CODES.unauthorized);
      }
      return;
    }
    if (this.authTimer) clearTimeout(this.authTimer);
    this.authTimer = null;
    this.device = result.device;
    this.releasePresence = this.deps.presence?.connected(result.device.id, this.transport.via ?? "direct") ?? null;
    this.deps.runningSubagents?.on("changed", this.onSubagents);
    this.deps.tracker.on("agents", this.onAgents);
    this.deps.tracker.on("status", this.onStatus);
    this.deps.devices.on("changed", this.onDevicesChanged);
    this.send({
      type: "hello",
      protocol: WIRE_PROTOCOL_VERSION,
      host: this.deps.host,
      device: { id: result.device.id, name: result.device.name },
      credentials: result.issuedToken ? { token: result.issuedToken } : undefined,
      agents: this.withHostInfo(this.deps.tracker.list()),
    });
  }

  /** Each agent with when it last finished (from the activity log) and its subagents still running. */
  private withHostInfo(agents: AgentInfo[]): AgentInfo[] {
    const { activity, runningSubagents } = this.deps;
    return agents.map((a) => {
      const running = runningSubagents?.count(a.pane_id) ?? 0;
      return { ...a, ...(activity ? { last_done_at: activity.lastFinished(a.pane_id) } : {}), ...(running > 0 ? { subagents_running: running } : {}) };
    });
  }

  private reject(code: Extract<ServerMessage, { type: "auth.error" }>["code"], message: string, closeCode: number): void {
    this.send({ type: "auth.error", code, message });
    this.transport.close(closeCode, code);
    this.close();
  }

  private async dispatch(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "call":
        try {
          const result = await this.call(msg.method, msg.params);
          this.send({ type: "result", id: msg.id, result });
        } catch (err) {
          const code = err instanceof HerdrRequestError || err instanceof LaunchError ? err.code : "internal";
          const message = err instanceof Error ? err.message : String(err);
          this.send({ type: "error", id: msg.id, error: { code, message } });
        }
        return;

      case "terminal.open":
        await this.openStream(
          msg.streamId,
          msg.paneId,
          msg.mode,
          msg.cols !== undefined && msg.rows !== undefined ? { cols: msg.cols, rows: msg.rows } : null,
          msg.render ?? "ansi",
        );
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

  private call(method: CallMethod, params: Record<string, unknown>): Promise<unknown> {
    if (method === "agent.read" || method === "pane.read") return this.deps.herdr.request(method, params, { timeoutMs: READ_TIMEOUT_MS });
    if (!method.startsWith("shepherd.")) return this.deps.herdr.request(method, params);
    if (method === "shepherd.activity") return Promise.resolve(this.deps.activity?.page(params as ActivityParams) ?? { entries: [] });
    if (method === "shepherd.changes" || method === "shepherd.file_diff") {
      const folder = (paneId: string) => {
        const agent = this.deps.tracker.get(paneId);
        return agent?.cwd || agent?.foreground_cwd || null;
      };
      const noFolder = { available: false, reason: "No folder known for this agent." };
      if (method === "shepherd.file_diff") {
        const parsed = fileDiffParams(params, isPaneId);
        if (!parsed) return Promise.reject(new LaunchError("invalid_params", `${method}: bad parameters`));
        const cwd = folder(parsed.paneId);
        return cwd ? fileDiff(cwd, parsed.path, parsed.mode) : Promise.resolve(noFolder);
      }
      const parsed = changesParams(params, isPaneId);
      if (!parsed) return Promise.reject(new LaunchError("invalid_params", `${method}: bad parameters`));
      const cwd = folder(parsed.paneId);
      return cwd ? changes(cwd, parsed.mode) : Promise.resolve(noFolder);
    }
    if (method === "shepherd.upload") {
      const { uploadId, mime, data, done } = params;
      if (typeof uploadId !== "string" || typeof mime !== "string" || typeof data !== "string" || typeof done !== "boolean") {
        return Promise.reject(new LaunchError("invalid_params", "shepherd.upload needs uploadId, mime, data and done"));
      }
      if (!this.deps.uploads) return Promise.reject(new LaunchError("unsupported", "This host can't receive images."));
      try {
        return Promise.resolve(this.deps.uploads.receive({ uploadId, mime, data, done }));
      } catch (err) {
        return Promise.reject(new LaunchError("invalid_params", (err as Error).message));
      }
    }
    if (method === "shepherd.model" || method === "shepherd.set_model") return this.model(method, params);
    const conversation = this.conversationCall(method, params);
    if (conversation) return conversation;
    // The phone's account of what it did in the background (notifications), for this host's log.
    if (method === "shepherd.log") {
      if (typeof params.text !== "string") return Promise.reject(new LaunchError("invalid_params", "shepherd.log needs text"));
      console.log(`[phone ${this.device?.name ?? "?"}] ${params.text.replace(/[\u0000-\u001f]/g, " ").slice(0, 300)}`);
      return Promise.resolve({});
    }
    if (method === "shepherd.commands") {
      if (!isPaneId(params.paneId)) return Promise.reject(new LaunchError("invalid_params", "shepherd.commands needs a paneId"));
      const commands = this.deps.commands;
      return Promise.resolve(commands ? commands.list(this.deps.tracker.get(params.paneId) ?? null) : { available: false, reason: "This host doesn't suggest commands." });
    }
    const launcher = this.deps.launcher;
    if (!launcher) return Promise.reject(new LaunchError("unsupported", `${method} is not available on this host`));
    if (method === "shepherd.projects") return launcher.projects();
    if (method === "shepherd.folders") return launcher.listFolders((params as { path?: string }).path);
    if (method === "shepherd.make_folder") return Promise.resolve().then(() => launcher.makeFolder(params));
    return launcher.start(params as StartAgentParams);
  }

  /** The `shepherd.*` methods that read the agent's conversation; null for any other method. */
  private conversationCall(method: CallMethod, params: Record<string, unknown>): Promise<unknown> | null {
    const run = <P extends { paneId: string }>(parsed: P | null, usage: string, read: (c: Conversations, agent: AgentInfo | null, p: P) => unknown) => {
      if (!parsed) return Promise.reject(new LaunchError("invalid_params", usage));
      const conversations = this.deps.conversations;
      if (!conversations) return Promise.resolve({ available: false, reason: "This host doesn't support conversations." });
      return Promise.resolve(read(conversations, this.deps.tracker.get(parsed.paneId) ?? null, parsed));
    };
    const pane = isPaneId(params.paneId) ? { paneId: params.paneId } : null;
    switch (method) {
      case "shepherd.subagents":
        return run(pane, "shepherd.subagents needs a paneId", (c, agent) => c.subagents(agent));
      case "shepherd.images":
        return run(pane, "shepherd.images needs a paneId", (c, agent) => c.images(agent));
      case "shepherd.image":
        return run(imageParams(params, isPaneId), "shepherd.image needs a paneId and an image id", (c, agent, p) => c.image(agent, p));
      case "shepherd.conversation":
        return run(conversationParams(params, isPaneId), "shepherd.conversation needs a paneId and whole-number after, before and limit", (c, agent, p) => c.get(agent, p));
      default:
        return null;
    }
  }

  private async model(method: "shepherd.model" | "shepherd.set_model", params: Record<string, unknown>): Promise<unknown> {
    const { paneId, model, effort } = params;
    if (!isPaneId(paneId)) throw new LaunchError("invalid_params", `${method} needs a paneId`);
    if (!this.deps.models) return { available: false, reason: "This host can't switch models." };
    const agent = this.deps.tracker.get(paneId) ?? null;
    try {
      if (method === "shepherd.model") return await this.deps.models.get(agent);
      const label = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 100 ? v : undefined);
      if (!label(model) && !label(effort)) throw new LaunchError("invalid_params", "shepherd.set_model needs a model or an effort");
      return await this.deps.models.set(agent, { paneId, model: label(model), effort: label(effort) });
    } catch (err) {
      if (err instanceof ModelError || err instanceof ScreenError) throw new LaunchError("model_unavailable", err.message);
      throw err;
    }
  }

  private async openStream(streamId: string, paneId: string, mode: TerminalMode, requested: Size | null, render: TerminalRender = "ansi"): Promise<void> {
    if (this.streams.has(streamId) || this.opening.has(streamId)) {
      this.streamError(streamId, "stream id already in use");
      return;
    }
    if (this.streams.size + this.opening.size >= MAX_STREAMS_PER_SESSION) {
      this.send({ type: "terminal.closed", streamId, reason: `too many open terminals (max ${MAX_STREAMS_PER_SESSION})` });
      return;
    }

    this.opening.add(streamId);
    const native = await this.paneSize(paneId);
    this.opening.delete(streamId);
    if (this.closed) return;

    const size = requested ?? native ?? FALLBACK_SIZE;
    // A controller at a different size resizes the real pane; put it back afterwards.
    const restoreTo =
      mode === "control" && requested && native && (native.cols !== requested.cols || native.rows !== requested.rows)
        ? native
        : null;

    const stream = this.deps.openTerminal(paneId, mode, size.cols, size.rows);
    this.streams.set(streamId, stream);
    // "lines": emulate the terminal here and send the screen as styled rows.
    const renderer =
      render === "lines"
        ? new ScreenRenderer(size.cols, size.rows, (update) => {
            if (!this.closed) this.send({ type: "terminal.lines", streamId, ...update });
          })
        : null;
    stream.on("frame", (frame) => {
      if (this.closed) return;
      if (renderer) {
        renderer.write(Buffer.from(frame.bytes, "base64"), { width: frame.width, height: frame.height });
        return;
      }
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
      renderer?.dispose();
      this.streams.delete(streamId);
      if (restoreTo) this.restorePaneSize(paneId, restoreTo);
      if (!this.closed) this.send({ type: "terminal.closed", streamId, reason });
    });
  }

  /** The pane's current size, from its tab layout. */
  private async paneSize(paneId: string): Promise<Size | null> {
    try {
      const result = await this.deps.herdr.request<{
        layout: { panes: { pane_id: string; rect: { width: number; height: number } }[] };
      }>("pane.layout", { pane_id: paneId });
      const rect = result.layout.panes.find((p) => p.pane_id === paneId)?.rect;
      return rect && rect.width > 0 && rect.height > 0 ? { cols: rect.width, rows: rect.height } : null;
    } catch {
      return null;
    }
  }

  /**
   * herdr keeps a pane at the last controller's size, so briefly take control
   * at the original size and release it.
   */
  private restorePaneSize(paneId: string, size: Size): void {
    const restorer = this.deps.openTerminal(paneId, "control", size.cols, size.rows);
    const timer = setTimeout(() => restorer.close(), RESTORE_TIMEOUT_MS);
    restorer.once("frame", () => {
      clearTimeout(timer);
      restorer.close();
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
