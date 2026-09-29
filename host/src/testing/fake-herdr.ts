import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentInfo, AgentStatus } from "@sheperd/protocol";
import { lineReader } from "../herdr-client.ts";

type Sub = { socket: Socket; subscriptions: Record<string, unknown>[] };
type Handler = (params: Record<string, unknown>) => unknown;

/** In-process stand-in for herdr's NDJSON socket API. */
export class FakeHerdr {
  readonly socketPath: string;
  readonly requests: { method: string; params: Record<string, unknown> }[] = [];
  agents: AgentInfo[] = [];
  handlers: Record<string, Handler> = {};
  private server: Server;
  private subs: Sub[] = [];
  private dir: string;
  private sockets = new Set<Socket>();

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), "fake-herdr-"));
    this.socketPath = join(this.dir, "herdr.sock");
    this.server = createServer((socket) => this.accept(socket));
  }

  listen(): Promise<void> {
    return new Promise((resolve) => this.server.listen(this.socketPath, resolve));
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    rmSync(this.dir, { recursive: true, force: true });
  }

  /** Drop every client connection, as if herdr restarted. */
  disconnectAll(): void {
    for (const socket of this.sockets) socket.destroy();
    this.subs = [];
  }

  subscriptionsFor(type: string): Record<string, unknown>[] {
    return this.subs.flatMap((s) => s.subscriptions.filter((x) => x.type === type));
  }

  setStatus(paneId: string, status: AgentStatus, { push = true } = {}): void {
    this.agents = this.agents.map((a) => (a.pane_id === paneId ? { ...a, agent_status: status } : a));
    if (!push) return;
    const agent = this.agents.find((a) => a.pane_id === paneId);
    this.push("pane.agent_status_changed", {
      pane_id: paneId,
      workspace_id: agent?.workspace_id ?? "w1",
      agent_status: status,
      agent: agent?.agent ?? null,
    });
  }

  push(event: string, data: Record<string, unknown>): void {
    for (const sub of this.subs) {
      const matches = sub.subscriptions.some(
        (s) => s.type === event && (s.pane_id === undefined || s.pane_id === data.pane_id),
      );
      if (matches && !sub.socket.destroyed) sub.socket.write(JSON.stringify({ event, data }) + "\n");
    }
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.on("close", () => {
      this.sockets.delete(socket);
      this.subs = this.subs.filter((s) => s.socket !== socket);
    });
    socket.on("error", () => {});
    socket.on(
      "data",
      lineReader((line) => {
        const req = JSON.parse(line) as { id: string; method: string; params: Record<string, unknown> };
        this.requests.push({ method: req.method, params: req.params });
        const reply = (body: Record<string, unknown>) => socket.write(JSON.stringify({ id: req.id, ...body }) + "\n");

        if (req.method === "events.subscribe") {
          this.subs.push({ socket, subscriptions: req.params.subscriptions as Record<string, unknown>[] });
          reply({ result: { type: "subscription_started" } });
          return;
        }
        const handler = this.handlers[req.method];
        if (handler) {
          Promise.resolve()
            .then(() => handler(req.params))
            .then(
              (result) => reply({ result }),
              (err) => reply({ error: { code: "handler_error", message: String(err) } }),
            );
          return;
        }
        if (req.method === "agent.list") {
          reply({ result: { type: "agent_list", agents: this.agents } });
          return;
        }
        if (req.method === "ping") {
          reply({ result: { type: "pong", version: "fake" } });
          return;
        }
        reply({ error: { code: "unknown_method", message: `unknown method ${req.method}` } });
      }),
    );
  }
}

export function fakeAgent(paneId: string, status: AgentStatus = "idle", extra: Partial<AgentInfo> = {}): AgentInfo {
  const [workspace = "w1"] = paneId.split(":");
  return {
    agent: "claude",
    agent_status: status,
    focused: false,
    pane_id: paneId,
    tab_id: `${workspace}:t1`,
    workspace_id: workspace,
    terminal_id: `term_${paneId.replace(":", "_")}`,
    revision: 1,
    ...extra,
  };
}

export async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}
