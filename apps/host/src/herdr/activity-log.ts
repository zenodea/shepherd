import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ActivityEntry, ActivityEvent, ActivityParams, ActivityResult, AgentInfo, StatusChange } from "@sheperd/protocol";
import type { AgentTracker } from "./agent-tracker.ts";

/** How many entries are kept (and saved). */
export const MAX_ENTRIES = 1000;
const MAX_PAGE = 200;
const SAVE_DELAY_MS = 2000;

/**
 * What your agents did, for the app's activity feed: every status change,
 * plus agents appearing and closing. Kept on disk next to the host config so
 * it survives restarts.
 */
export class ActivityLog {
  private entries: ActivityEntry[] = [];
  private nextId = 1;
  /** Agent panes seen so far; null until the first list (which isn't "started"). */
  private known: Map<string, AgentInfo> | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly path: string | null;
  private readonly now: () => number;
  private readonly onStatus = (change: StatusChange) => {
    if (change.agent) this.add(change.status, change.previous, change.agent);
  };
  private readonly onAgents = (agents: AgentInfo[]) => this.diff(agents);

  constructor(opts: { path?: string | null; now?: () => number } = {}) {
    this.path = opts.path ?? null;
    this.now = opts.now ?? Date.now;
    this.load();
  }

  attach(tracker: AgentTracker): () => void {
    this.known = new Map(tracker.list().map((a) => [a.pane_id, a]));
    tracker.on("status", this.onStatus);
    tracker.on("agents", this.onAgents);
    return () => {
      tracker.off("status", this.onStatus);
      tracker.off("agents", this.onAgents);
    };
  }

  /** Newest first, `limit` entries older than `before`. */
  page({ before, limit }: ActivityParams = {}): ActivityResult {
    const max = Math.min(Math.max(1, Number(limit) || 50), MAX_PAGE);
    const older = typeof before === "number" ? this.entries.filter((e) => e.id < before) : this.entries;
    return { entries: older.slice(-max).reverse() };
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.save();
  }

  private diff(agents: AgentInfo[]): void {
    const next = new Map(agents.map((a) => [a.pane_id, a]));
    if (this.known) {
      for (const [paneId, agent] of next) if (!this.known.has(paneId)) this.add("started", null, agent);
      for (const [paneId, agent] of this.known) if (!next.has(paneId)) this.add("closed", agent.agent_status, agent);
    }
    this.known = next;
  }

  private add(event: ActivityEvent, previous: ActivityEntry["previous"], agent: AgentInfo): void {
    // "unknown" is herdr still working out what the pane is; not news.
    if (event === "unknown" || (previous === "unknown" && event === "idle")) return;
    this.entries.push({
      id: this.nextId++,
      at: this.now(),
      event,
      previous,
      paneId: agent.pane_id,
      workspaceId: agent.workspace_id,
      agent: agent.agent ?? null,
      name: agent.name ?? null,
      title: agent.terminal_title_stripped || agent.title || null,
      cwd: agent.cwd ?? agent.foreground_cwd ?? null,
    });
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (!this.path || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, SAVE_DELAY_MS);
    this.saveTimer.unref();
  }

  private load(): void {
    if (!this.path) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as { entries?: ActivityEntry[] };
      this.entries = (parsed.entries ?? []).filter((e) => typeof e?.id === "number" && typeof e.at === "number").slice(-MAX_ENTRIES);
      this.nextId = (this.entries[this.entries.length - 1]?.id ?? 0) + 1;
    } catch {
      // first run, or unreadable: start fresh
    }
  }

  private save(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify({ entries: this.entries }), { mode: 0o600 });
      renameSync(tmp, this.path);
    } catch {
      // the feed is a convenience; never take the host down over it
    }
  }
}
