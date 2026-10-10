import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ActionContext,
  AgentInfo,
  Card,
  CardsParams,
  CardsResult,
  PluginActionParams,
  PluginActionResult,
  PluginLogParams,
  PluginLogResult,
  PluginPaneParams,
  PluginRun,
  PluginSource,
  PluginPaneResult,
  PluginSummary,
  PluginsResult,
} from "@shepherd/protocol";
import type { HerdrClient } from "../herdr/herdr-client.ts";
import { pluginsOff, readStoredConfig } from "../system/config.ts";
import { runCardCommand, type CardRunner } from "./card-runner.ts";
import { SIDECAR_FILE, parseSidecar, type Sidecar, type SidecarCard } from "./sidecar.ts";

export type HerdrPlugin = {
  plugin_id: string;
  name: string;
  version: string;
  description?: string | null;
  enabled: boolean;
  plugin_root: string;
  actions?: { id: string; title: string; description?: string | null; contexts?: ActionContext[] }[];
  panes?: { id: string; title: string; description?: string | null }[];
  source?: { kind?: "local" | "github"; owner?: string | null; repo?: string | null; resolved_commit?: string | null; installed_unix_ms?: number | null };
};

export type InstalledPlugin = {
  info: HerdrPlugin;
  sidecar: Sidecar | null;
  sidecarError: string | null;
  /** Switched off for phones in the Shepherd window. */
  off: boolean;
};

type HerdrLog = {
  log_id: string;
  status: "running" | "succeeded" | "failed";
  action_id?: string | null;
  event?: string | null;
  started_unix_ms?: number;
  finished_unix_ms?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  error?: string | null;
  exit_code?: number | null;
};

export class PluginError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type PluginsDeps = {
  herdr: HerdrClient;
  configPath: string;
  tracker: { get: (paneId: string) => AgentInfo | null };
  herdrBin: string;
  socketPath: string;
  env?: NodeJS.ProcessEnv;
  run?: CardRunner;
  now?: () => number;
};

const MAX_CARD_AGE_MS = 10 * 60_000;
const INVOKE_WAIT_MS = 15_000;
const INVOKE_POLL_MS = 400;
const OUTPUT_TAIL = 2000;

export const selfPluginId = (env: NodeJS.ProcessEnv = process.env): string => env.HERDR_PLUGIN_ID || "shepherd";

export async function listInstalled(herdr: HerdrClient, configPath: string, env: NodeJS.ProcessEnv = process.env): Promise<InstalledPlugin[]> {
  const { plugins } = await herdr.request<{ plugins: HerdrPlugin[] }>("plugin.list");
  const off = pluginsOff(readStoredConfig(configPath));
  const self = selfPluginId(env);
  return plugins
    .filter((p) => p.plugin_id !== self)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((info) => {
      let sidecar: Sidecar | null = null;
      let sidecarError: string | null = null;
      const path = join(info.plugin_root, SIDECAR_FILE);
      if (existsSync(path)) {
        try {
          sidecar = parseSidecar(readFileSync(path, "utf8"));
        } catch (err) {
          sidecarError = (err as Error).message;
        }
      }
      return { info, sidecar, sidecarError, off: off.has(info.plugin_id) };
    });
}

const tildify = (path: string, home = homedir()) => (path === home || path.startsWith(home + "/") ? "~" + path.slice(home.length) : path);

export function sourceOf(info: HerdrPlugin): PluginSource {
  const source = info.source;
  if (source?.kind === "github" && source.repo) {
    return { kind: "github", repo: source.owner ? `${source.owner}/${source.repo}` : source.repo, commit: source.resolved_commit ?? null, installedAt: source.installed_unix_ms ?? null };
  }
  return { kind: "local", path: tildify(info.plugin_root) };
}

const tail = (s: string | null | undefined) => (s && s.trim() ? s.trim().slice(-OUTPUT_TAIL) : null);

export function summarize({ info, sidecar, sidecarError }: InstalledPlugin): PluginSummary {
  return {
    id: info.plugin_id,
    name: info.name,
    version: info.version,
    description: info.description ?? null,
    source: sourceOf(info),
    actions: (info.actions ?? []).map((a) => ({ id: a.id, title: a.title, description: a.description ?? null, contexts: a.contexts ?? [] })),
    panes: (info.panes ?? []).map((p) => ({ id: p.id, title: p.title, description: p.description ?? null })),
    cards: (sidecar?.cards ?? []).map((c) => ({ id: c.id, title: c.title, context: c.context })),
    ...(sidecarError ? { sidecarError } : {}),
  };
}

const workspaceOf = (paneId: string) => paneId.split(":")[0]!;

/** herdr's "tab" and "selection" contexts have no phone equivalent beyond the pane; "selection" needs text we don't have. */
function appliesHere(contexts: ActionContext[], withPane: boolean): boolean {
  if (contexts.length === 0) return true;
  if (contexts.includes("global")) return true;
  return withPane && contexts.some((c) => c === "pane" || c === "tab" || c === "workspace");
}

type Cached = { card: Card | null; at: number; status: string | null };

export class Plugins {
  private readonly deps: PluginsDeps;
  private readonly run: CardRunner;
  private readonly now: () => number;
  private cache = new Map<string, Cached>();
  private inFlight = new Map<string, Promise<Card | null>>();

  constructor(deps: PluginsDeps) {
    this.deps = deps;
    this.run = deps.run ?? runCardCommand;
    this.now = deps.now ?? Date.now;
  }

  private installed(): Promise<InstalledPlugin[]> {
    return listInstalled(this.deps.herdr, this.deps.configPath, this.deps.env);
  }

  private async onForPhones(): Promise<InstalledPlugin[]> {
    return (await this.installed()).filter((p) => p.info.enabled && !p.off);
  }

  async list(): Promise<PluginsResult> {
    return { plugins: (await this.onForPhones()).map(summarize) };
  }

  async cards({ paneId, refresh = false }: CardsParams): Promise<CardsResult> {
    const agent = paneId ? this.deps.tracker.get(paneId) : null;
    const cards: Card[] = [];
    for (const plugin of await this.onForPhones()) {
      const runs = (plugin.sidecar?.cards ?? [])
        .filter((spec) => spec.context === "global" || paneId)
        .map((spec) => this.card(plugin, spec, paneId ?? null, agent, refresh));
      for (const card of await Promise.all(runs)) if (card) cards.push(card);
      const actions = this.actionsCard(plugin, Boolean(paneId));
      if (actions) cards.push(actions);
    }
    return { cards };
  }

  private actionsCard(plugin: InstalledPlugin, withPane: boolean): Card | null {
    if (plugin.sidecar?.actions === false) return null;
    const actions = (plugin.info.actions ?? []).filter((a) => appliesHere(a.contexts ?? [], withPane));
    if (actions.length === 0) return null;
    return {
      plugin: plugin.info.plugin_id,
      pluginName: plugin.info.name,
      id: "actions",
      title: "Actions",
      context: withPane ? "pane" : "global",
      updatedAt: 0,
      body: { rows: [], buttons: actions.map((a) => ({ label: a.title, action: a.id })) },
    };
  }

  private card(plugin: InstalledPlugin, spec: SidecarCard, paneId: string | null, agent: AgentInfo | null, force: boolean): Promise<Card | null> {
    const scope = spec.context === "global" ? "global" : spec.context === "workspace" ? workspaceOf(paneId!) : paneId!;
    const key = `${plugin.info.plugin_id}/${spec.id}/${scope}`;
    const status = agent?.agent_status ?? null;
    const cached = this.cache.get(key);
    if (cached && !force && !this.stale(cached, spec, status)) return Promise.resolve(cached.card);
    const running = this.inFlight.get(key);
    if (running) return running;
    const promise = this.runCard(plugin, spec, spec.context === "global" ? null : paneId, spec.context === "global" ? null : agent)
      .then((card) => {
        this.cache.set(key, { card, at: this.now(), status });
        return card;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private stale(cached: Cached, spec: SidecarCard, status: string | null): boolean {
    const age = this.now() - cached.at;
    if (age > MAX_CARD_AGE_MS) return true;
    if (spec.refresh === "status") return cached.status !== status;
    return age > spec.refresh * 1000;
  }

  private async runCard(plugin: InstalledPlugin, spec: SidecarCard, paneId: string | null, agent: AgentInfo | null): Promise<Card | null> {
    const base = { plugin: plugin.info.plugin_id, pluginName: plugin.info.name, id: spec.id, title: spec.title, context: spec.context };
    const result = await this.run(spec.command, {
      cwd: plugin.info.plugin_root,
      env: { ...this.pluginEnv(plugin.info, paneId, agent), SHEPHERD_CARD: spec.id, SHEPHERD_CONTEXT: spec.context },
      timeoutMs: spec.timeoutMs,
    });
    if (!result.ok) return { ...base, updatedAt: this.now(), error: result.error };
    if (result.body === "hide") return null;
    return { ...base, updatedAt: this.now(), body: result.body };
  }

  /** The variables herdr gives plugin commands, so a card can reuse the plugin's own code paths. */
  private pluginEnv(info: HerdrPlugin, paneId: string | null, agent: AgentInfo | null): NodeJS.ProcessEnv {
    const env = this.deps.env ?? process.env;
    const configHome = env.XDG_CONFIG_HOME || join(homedir(), ".config");
    const stateHome = env.XDG_STATE_HOME || join(homedir(), ".local", "state");
    const context = this.context(paneId, agent);
    const out: NodeJS.ProcessEnv = {
      ...env,
      HERDR_PLUGIN_ID: info.plugin_id,
      HERDR_PLUGIN_ROOT: info.plugin_root,
      HERDR_PLUGIN_CONFIG_DIR: join(configHome, "herdr", "plugins", "config", info.plugin_id),
      HERDR_PLUGIN_STATE_DIR: join(stateHome, "herdr", "plugins", info.plugin_id),
      HERDR_BIN_PATH: this.deps.herdrBin,
      HERDR_SOCKET_PATH: this.deps.socketPath,
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify(context),
    };
    if (paneId) {
      out.HERDR_PANE_ID = out.HERDR_ACTIVE_PANE_ID = paneId;
      out.HERDR_WORKSPACE_ID = out.HERDR_ACTIVE_WORKSPACE_ID = workspaceOf(paneId);
      const cwd = agent?.cwd ?? agent?.foreground_cwd;
      if (cwd) out.HERDR_ACTIVE_PANE_CWD = cwd;
    }
    return out;
  }

  private context(paneId: string | null, agent: AgentInfo | null): Record<string, unknown> {
    const context: Record<string, unknown> = { invocation_source: "shepherd" };
    if (!paneId) return context;
    context.focused_pane_id = paneId;
    context.workspace_id = agent?.workspace_id ?? workspaceOf(paneId);
    if (agent) {
      context.tab_id = agent.tab_id;
      context.focused_pane_agent = agent.agent ?? null;
      context.focused_pane_status = agent.agent_status;
      context.focused_pane_cwd = agent.cwd ?? agent.foreground_cwd ?? null;
      context.workspace_cwd = agent.cwd ?? null;
    }
    return context;
  }

  private async pluginNamed(id: string): Promise<InstalledPlugin> {
    const plugin = (await this.onForPhones()).find((p) => p.info.plugin_id === id);
    if (!plugin) throw new PluginError("not_found", `The plugin "${id}" isn't on for phones, or isn't installed.`);
    return plugin;
  }

  async invoke({ plugin: id, action, paneId }: PluginActionParams): Promise<PluginActionResult> {
    const plugin = await this.pluginNamed(id);
    if (!(plugin.info.actions ?? []).some((a) => a.id === action)) throw new PluginError("not_found", `${plugin.info.name} has no action "${action}".`);
    const agent = paneId ? this.deps.tracker.get(paneId) : null;
    const { log } = await this.deps.herdr.request<{ log: HerdrLog }>("plugin.action.invoke", {
      plugin_id: id,
      action_id: action,
      context: this.context(paneId ?? null, agent),
    });
    const finished = await this.awaitLog(id, log);
    for (const key of this.cache.keys()) if (key.startsWith(`${id}/`)) this.cache.delete(key);
    if (finished.status === "running") return { status: "running", output: null, error: null };
    if (finished.status === "failed") {
      return { status: "failed", output: tail(finished.stdout), error: finished.error ?? tail(finished.stderr) ?? `Exited with code ${finished.exit_code ?? "?"}.` };
    }
    return { status: "succeeded", output: tail(finished.stdout), error: null };
  }

  private async awaitLog(pluginId: string, log: HerdrLog): Promise<HerdrLog> {
    const deadline = this.now() + INVOKE_WAIT_MS;
    let latest = log;
    while (latest.status === "running" && this.now() < deadline) {
      await new Promise((r) => setTimeout(r, INVOKE_POLL_MS));
      const { logs } = await this.deps.herdr.request<{ logs: HerdrLog[] }>("plugin.log.list", { plugin_id: pluginId, limit: 20 });
      latest = logs.find((l) => l.log_id === log.log_id) ?? latest;
    }
    return latest;
  }

  async log({ plugin: id, limit = 5 }: PluginLogParams): Promise<PluginLogResult> {
    const plugin = await this.pluginNamed(id);
    const { logs } = await this.deps.herdr.request<{ logs: HerdrLog[] }>("plugin.log.list", { plugin_id: id, limit: Math.min(Math.max(1, limit), 50) });
    const titles = new Map((plugin.info.actions ?? []).map((a) => [a.id, a.title]));
    const runs: PluginRun[] = logs.map((l) => ({
      id: l.log_id,
      what: l.action_id ? (titles.get(l.action_id) ?? l.action_id) : l.event ? `on ${l.event}` : "startup",
      startedAt: l.started_unix_ms ?? 0,
      finishedAt: l.finished_unix_ms ?? null,
      status: l.status,
      output: tail(l.stdout),
      error: l.status === "failed" ? (l.error ?? tail(l.stderr) ?? `Exited with code ${l.exit_code ?? "?"}.`) : null,
    }));
    return { runs: runs.sort((a, b) => b.startedAt - a.startedAt) };
  }

  async openPane({ plugin: id, pane, paneId }: PluginPaneParams): Promise<PluginPaneResult> {
    const plugin = await this.pluginNamed(id);
    if (!(plugin.info.panes ?? []).some((p) => p.id === pane)) throw new PluginError("not_found", `${plugin.info.name} has no pane "${pane}".`);
    const params: Record<string, unknown> = { plugin_id: id, entrypoint: pane, placement: "tab", focus: false };
    if (paneId) {
      params.workspace_id = this.deps.tracker.get(paneId)?.workspace_id ?? workspaceOf(paneId);
      params.target_pane_id = paneId;
    }
    const { plugin_pane } = await this.deps.herdr.request<{ plugin_pane: { pane: { pane_id: string; workspace_id: string } } }>("plugin.pane.open", params);
    return { paneId: plugin_pane.pane.pane_id, workspaceId: plugin_pane.pane.workspace_id };
  }
}
