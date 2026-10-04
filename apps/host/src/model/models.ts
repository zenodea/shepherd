import { choiceId, type AgentInfo, type ModelChoice, type ModelResult, type SetModelParams } from "@shepherd/protocol";
import type { HerdrClient } from "../herdr/herdr-client.ts";
import { PaneScreen } from "./screen.ts";

/** An agent's choices and what it's using now: a `choiceId` of a model and an effort's label. */
export type ModelMenu = { model: string | null; effort: string | null; models: ModelChoice[]; efforts: ModelChoice[] };
export type ModelChange = { model?: string; effort?: string };

/** How one agent harness shows and switches its model, through its own menus. */
export type ModelVendor = {
  /** herdr's agent kind, e.g. "claude". */
  readonly id: string;
  /** Reading doesn't touch the agent (e.g. it comes from a command line), so it works while the agent is busy. */
  readonly quiet?: boolean;
  /** Reads the choices and what's in use: by opening the agent's menus (and closing them again), unless `quiet`. */
  read(screen: PaneScreen): Promise<ModelMenu>;
  /** What it's using now, from its screen and its transcript's model id, without touching it. */
  glance(screen: string, transcriptModel: string | null, menu: ModelMenu): { model: string | null; effort: string | null };
  /** Switches for this session only, and returns the menu as it is afterwards. */
  choose(screen: PaneScreen, change: ModelChange, menu: ModelMenu): Promise<ModelMenu>;
};

export class ModelError extends Error {}

/** The choices change with an agent's version, not from one session to the next. */
const MENU_TTL_MS = 30 * 60_000;

/** Same model, however it's written: "Opus 5.5", "claude-opus-5-5", "claude-haiku-4-5-20251001". */
export const sameModel = (a: string, b: string) => {
  const key = (s: string) => s.toLowerCase().replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/[^a-z0-9]/g, "");
  return key(a) === key(b);
};

const agentName = (agent: AgentInfo) => agent.display_agent ?? agent.agent ?? "the agent";

/** Models and effort for agents, read and switched by driving each agent's own menus. */
export class Models {
  private readonly herdr: HerdrClient;
  private readonly vendors: ModelVendor[];
  private readonly transcriptModel: (agent: AgentInfo) => string | null;
  private readonly menus = new Map<string, { menu: ModelMenu; at: number }>();
  private readonly panes = new Map<string, ModelMenu>();
  private readonly busy = new Set<string>();

  constructor(opts: { herdr: HerdrClient; vendors: ModelVendor[]; transcriptModel?: (agent: AgentInfo) => string | null }) {
    this.herdr = opts.herdr;
    this.vendors = opts.vendors;
    this.transcriptModel = opts.transcriptModel ?? (() => null);
  }

  async get(agent: AgentInfo | null): Promise<ModelResult> {
    const found = this.vendor(agent);
    if ("reason" in found) return found;
    const { vendor, agent: a } = found;
    const screen = new PaneScreen(this.herdr, a.pane_id);
    const lists = this.menus.get(vendor.id);
    if (lists && Date.now() - lists.at < MENU_TTL_MS) {
      const known = this.panes.get(a.pane_id);
      const menu = { ...lists.menu, ...(known ? { efforts: known.efforts } : {}) };
      const now = vendor.glance(await screen.read(), this.transcriptModel(a), menu);
      return this.result(vendor, { ...menu, model: now.model ?? known?.model ?? null, effort: now.effort ?? known?.effort ?? null });
    }
    const menu = vendor.quiet ? await vendor.read(screen) : await this.driving(a, () => vendor.read(screen));
    this.remember(vendor, a, menu);
    return this.result(vendor, menu);
  }

  async set(agent: AgentInfo | null, params: SetModelParams): Promise<ModelResult> {
    const found = this.vendor(agent);
    if ("reason" in found) return found;
    const { vendor, agent: a } = found;
    const screen = new PaneScreen(this.herdr, a.pane_id);
    const change: ModelChange = { model: params.model, effort: params.effort };
    const menu = await this.driving(a, async () => {
      const lists = this.menus.get(vendor.id)?.menu;
      const known = this.panes.get(a.pane_id);
      const menu = lists ? { ...lists, model: known?.model ?? null, effort: known?.effort ?? null, efforts: known?.efforts ?? lists.efforts } : await vendor.read(screen);
      if (change.model && !menu.models.some((m) => choiceId(m) === change.model)) throw new ModelError(`${change.model} isn't one of ${agentName(a)}'s models.`);
      if (change.effort && !menu.efforts.some((e) => e.label === change.effort)) throw new ModelError(`${change.effort} isn't an effort level ${agentName(a)} offers.`);
      return vendor.choose(screen, change, menu);
    });
    this.remember(vendor, a, menu);
    return this.result(vendor, menu);
  }

  /** The lists for every agent of this kind; what's in use for this pane alone. */
  private remember(vendor: ModelVendor, agent: AgentInfo, menu: ModelMenu): void {
    this.menus.set(vendor.id, { menu, at: Date.now() });
    this.panes.set(agent.pane_id, menu);
  }

  private vendor(agent: AgentInfo | null): { vendor: ModelVendor; agent: AgentInfo } | { available: false; reason: string } {
    if (!agent) return { available: false, reason: "This tab isn't an agent." };
    const vendor = this.vendors.find((v) => v.id === agent.agent);
    if (!vendor) return { available: false, reason: `Switching models isn't supported for ${agentName(agent)} yet.` };
    return { vendor, agent };
  }

  /** Runs `drive` on an idle agent's screen, one at a time per pane. */
  private async driving<T>(agent: AgentInfo, drive: () => Promise<T>): Promise<T> {
    if (agent.agent_status !== "idle" && agent.agent_status !== "done") throw new ModelError(`Available when ${agentName(agent)} is done.`);
    if (this.busy.has(agent.pane_id)) throw new ModelError(`Already talking to ${agentName(agent)}'s menus.`);
    this.busy.add(agent.pane_id);
    try {
      return await drive();
    } finally {
      this.busy.delete(agent.pane_id);
    }
  }

  private result(vendor: ModelVendor, menu: ModelMenu): ModelResult {
    return { available: true, agent: vendor.id, ...menu };
  }
}
