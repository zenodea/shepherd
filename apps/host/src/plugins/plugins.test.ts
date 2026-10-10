import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentInfo, Card } from "@shepherd/protocol";
import { HerdrClient } from "../herdr/herdr-client.ts";
import { setPluginOff } from "../system/config.ts";
import { FakeHerdr, fakeAgent } from "../testing/fake-herdr.ts";
import { runCardCommand } from "./card-runner.ts";
import { Plugins, listInstalled, type HerdrPlugin } from "./plugins.ts";

const body = (card: Card | undefined) => (card && "body" in card ? card.body : null);
const error = (card: Card | undefined) => (card && "error" in card ? card.error : null);

describe("Plugins", () => {
  let herdr: FakeHerdr;
  let client: HerdrClient;
  let dir: string;
  let configPath: string;
  let now: number;
  let runs: { command: string[]; env: NodeJS.ProcessEnv; cwd: string }[];
  let output: unknown;
  let agents: Record<string, AgentInfo>;
  let plugins: Plugins;

  const plugin = (id: string, root: string, extra: Partial<HerdrPlugin> = {}): HerdrPlugin => ({
    plugin_id: id,
    name: id,
    version: "0.1.0",
    enabled: true,
    plugin_root: root,
    actions: [{ id: "open", title: `${id}: open`, contexts: ["workspace"] }],
    panes: [{ id: "tui", title: id }],
    ...extra,
  });

  const sidecar = (root: string, text: string) => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "shepherd.toml"), text);
  };

  beforeEach(async () => {
    herdr = new FakeHerdr();
    await herdr.listen();
    client = new HerdrClient(herdr.socketPath, 1000);
    dir = mkdtempSync(join(tmpdir(), "shepherd-plugins-"));
    configPath = join(dir, "host.json");
    now = 1_000_000;
    runs = [];
    output = { rows: [{ kind: "badge", text: "penned", tone: "ok" }], buttons: [{ label: "Open", action: "open" }] };
    agents = { "w1:p1": fakeAgent("w1:p1", "working", { cwd: "/code/api" }) };
    const fenceRoot = join(dir, "fence");
    sidecar(fenceRoot, '[[cards]]\nid = "pen"\ntitle = "Pen"\ncommand = ["node", "card.ts"]\n\n[[cards]]\nid = "pens"\ntitle = "Pens"\ncontext = "global"\ncommand = ["node", "pens.ts"]\nrefresh = 30');
    sidecar(join(dir, "broken"), "[[cards]\n");
    herdr.handlers["plugin.list"] = () => ({
      type: "plugin_list",
      plugins: [
        plugin("shepherd", join(dir, "shepherd")),
        plugin("graphdiff", join(dir, "graphdiff"), { actions: [{ id: "open", title: "graphdiff: review", contexts: ["workspace"] }, { id: "copy", title: "copy", contexts: ["selection"] }] }),
        plugin("fence", fenceRoot),
        plugin("broken", join(dir, "broken")),
        plugin("sleeping", join(dir, "sleeping"), { enabled: false }),
      ],
    });
    plugins = new Plugins({
      herdr: client,
      configPath,
      tracker: { get: (id) => agents[id] ?? null },
      herdrBin: "/bin/herdr",
      socketPath: herdr.socketPath,
      env: { HERDR_PLUGIN_ID: "shepherd", XDG_CONFIG_HOME: "/cfg", XDG_STATE_HOME: "/state", PATH: "/bin" },
      now: () => now,
      run: async (command, { env, cwd }) => {
        runs.push({ command, env, cwd });
        return { ok: true, body: output === "hide" ? "hide" : (output as { rows: never[]; buttons: never[] }) };
      },
    });
  });

  afterEach(async () => {
    client.close();
    await herdr.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists herdr's enabled plugins except Shepherd, with their cards and sidecar problems", async () => {
    const { plugins: list } = await plugins.list();
    expect(list.map((p) => p.id)).toEqual(["broken", "fence", "graphdiff"]);
    expect(list[1]).toMatchObject({ id: "fence", cards: [{ id: "pen", context: "pane" }, { id: "pens", context: "global" }] });
    expect(list[0]?.sidecarError).toMatch(/isn't valid TOML/);
    expect(list[2]?.actions).toEqual([
      { id: "open", title: "graphdiff: review", description: null, contexts: ["workspace"] },
      { id: "copy", title: "copy", description: null, contexts: ["selection"] },
    ]);
  });

  it("says where a plugin came from", async () => {
    const home = process.env.HOME!;
    herdr.handlers["plugin.list"] = () => ({
      type: "plugin_list",
      plugins: [
        plugin("fence", `${home}/Documents/fence`),
        plugin("graphdiff", "/x/graphdiff", { source: { kind: "github", owner: "zenodea", repo: "graphdiff", resolved_commit: "abc123", installed_unix_ms: 1_700_000_000_000 } }),
      ],
    });
    const { plugins: list } = await plugins.list();
    expect(list.map((p) => p.source)).toEqual([
      { kind: "local", path: "~/Documents/fence" },
      { kind: "github", repo: "zenodea/graphdiff", commit: "abc123", installedAt: 1_700_000_000_000 },
    ]);
  });

  it("lists a plugin's recent runs, newest first, named by their action", async () => {
    herdr.handlers["plugin.log.list"] = () => ({
      type: "plugin_log_list",
      logs: [
        { log_id: "L1", status: "succeeded", action_id: "open", started_unix_ms: 100, finished_unix_ms: 150, stdout: "opened\n" },
        { log_id: "L2", status: "failed", event: "pane.created", started_unix_ms: 300, finished_unix_ms: 310, stderr: "no pen\n", exit_code: 1 },
        { log_id: "L3", status: "running", started_unix_ms: 200 },
      ],
    });
    expect(await plugins.log({ plugin: "fence" })).toEqual({
      runs: [
        { id: "L2", what: "on pane.created", startedAt: 300, finishedAt: 310, status: "failed", output: null, error: "no pen" },
        { id: "L3", what: "startup", startedAt: 200, finishedAt: null, status: "running", output: null, error: null },
        { id: "L1", what: "fence: open", startedAt: 100, finishedAt: 150, status: "succeeded", output: "opened", error: null },
      ],
    });
    expect(herdr.requests.find((r) => r.method === "plugin.log.list")!.params).toEqual({ plugin_id: "fence", limit: 5 });
  });

  it("leaves out plugins switched off in the window, but the window still sees them", async () => {
    setPluginOff(configPath, "fence", true);
    expect((await plugins.list()).plugins.map((p) => p.id)).toEqual(["broken", "graphdiff"]);
    const all = await listInstalled(client, configPath, { HERDR_PLUGIN_ID: "shepherd" });
    expect(all.map((p) => [p.info.plugin_id, p.off])).toEqual([["broken", false], ["fence", true], ["graphdiff", false], ["sleeping", false]]);
    await expect(plugins.invoke({ plugin: "fence", action: "open", paneId: "w1:p1" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("runs an agent's cards with herdr's variables, and makes an actions card for every plugin", async () => {
    const { cards } = await plugins.cards({ paneId: "w1:p1" });
    expect(cards.map((c) => `${c.plugin}/${c.id}`)).toEqual(["broken/actions", "fence/pen", "fence/pens", "fence/actions", "graphdiff/actions"]);
    expect(body(cards[1])).toEqual(output);
    expect(body(cards[4])?.buttons).toEqual([{ label: "graphdiff: review", action: "open" }]);
    const run = runs.find((r) => r.command[1] === "card.ts")!;
    expect(run.cwd).toBe(join(dir, "fence"));
    expect(run.env).toMatchObject({
      PATH: "/bin",
      HERDR_PLUGIN_ID: "fence",
      HERDR_PLUGIN_ROOT: join(dir, "fence"),
      HERDR_PLUGIN_CONFIG_DIR: "/cfg/herdr/plugins/config/fence",
      HERDR_PLUGIN_STATE_DIR: "/state/herdr/plugins/fence",
      HERDR_BIN_PATH: "/bin/herdr",
      HERDR_SOCKET_PATH: herdr.socketPath,
      HERDR_PANE_ID: "w1:p1",
      HERDR_WORKSPACE_ID: "w1",
      HERDR_ACTIVE_PANE_CWD: "/code/api",
      SHEPHERD_CARD: "pen",
      SHEPHERD_CONTEXT: "pane",
    });
    expect(JSON.parse(run.env.HERDR_PLUGIN_CONTEXT_JSON!)).toMatchObject({ invocation_source: "shepherd", focused_pane_id: "w1:p1", workspace_id: "w1", focused_pane_status: "working", focused_pane_cwd: "/code/api" });
    const pens = runs.find((r) => r.command[1] === "pens.ts")!;
    expect(pens.env.HERDR_PANE_ID).toBeUndefined();
  });

  it("without a pane shows only the computer's cards and global actions", async () => {
    const { cards } = await plugins.cards({});
    expect(cards.map((c) => `${c.plugin}/${c.id}`)).toEqual(["fence/pens"]);
  });

  it("serves a card again until the agent's status changes, a timed card until its time is up, and on demand", async () => {
    await plugins.cards({ paneId: "w1:p1" });
    await plugins.cards({ paneId: "w1:p1" });
    expect(runs).toHaveLength(2);
    agents["w1:p1"] = fakeAgent("w1:p1", "idle", { cwd: "/code/api" });
    await plugins.cards({ paneId: "w1:p1" });
    expect(runs.map((r) => r.command[1])).toEqual(["card.ts", "pens.ts", "card.ts"]);
    now += 31_000;
    await plugins.cards({ paneId: "w1:p1" });
    expect(runs.map((r) => r.command[1])).toEqual(["card.ts", "pens.ts", "card.ts", "pens.ts"]);
    await plugins.cards({ paneId: "w1:p1", refresh: true });
    expect(runs).toHaveLength(6);
    now += 11 * 60_000;
    await plugins.cards({ paneId: "w1:p1" });
    expect(runs).toHaveLength(8);
  });

  it("drops a card that hides itself and shows a card command's failure on the card", async () => {
    output = "hide";
    expect((await plugins.cards({ paneId: "w1:p1" })).cards.map((c) => `${c.plugin}/${c.id}`)).toEqual(["broken/actions", "fence/actions", "graphdiff/actions"]);
    const failing = new Plugins({
      herdr: client,
      configPath,
      tracker: { get: () => null },
      herdrBin: "herdr",
      socketPath: herdr.socketPath,
      env: { HERDR_PLUGIN_ID: "shepherd" },
      run: async () => ({ ok: false, error: "The card command exited with code 1: boom" }),
    });
    const { cards } = await failing.cards({ paneId: "w1:p1" });
    expect(error(cards.find((c) => c.id === "pen"))).toBe("The card command exited with code 1: boom");
  });

  it("invokes an action through herdr with the agent's context, waits for it, and forgets the plugin's cards", async () => {
    let polls = 0;
    herdr.handlers["plugin.action.invoke"] = (p) => ({
      type: "plugin_action_invoked",
      action: { plugin_id: p.plugin_id, action_id: p.action_id },
      context: p.context,
      log: { log_id: "L1", plugin_id: p.plugin_id, command: ["x"], status: "running", started_unix_ms: 1 },
    });
    herdr.handlers["plugin.log.list"] = () => ({
      type: "plugin_log_list",
      logs: [{ log_id: "L1", plugin_id: "fence", command: ["x"], status: ++polls >= 2 ? "succeeded" : "running", started_unix_ms: 1, stdout: "opened pen\n" }],
    });
    await plugins.cards({ paneId: "w1:p1" });
    const result = await plugins.invoke({ plugin: "fence", action: "open", paneId: "w1:p1" });
    expect(result).toEqual({ status: "succeeded", output: "opened pen", error: null });
    const invoke = herdr.requests.find((r) => r.method === "plugin.action.invoke")!;
    expect(invoke.params).toMatchObject({ plugin_id: "fence", action_id: "open", context: { invocation_source: "shepherd", focused_pane_id: "w1:p1", workspace_id: "w1" } });
    const before = runs.length;
    await plugins.cards({ paneId: "w1:p1" });
    expect(runs.length).toBe(before + 2);
    await expect(plugins.invoke({ plugin: "fence", action: "nope" })).rejects.toThrow(/has no action "nope"/);
  });

  it("reports a failed action", async () => {
    herdr.handlers["plugin.action.invoke"] = () => ({
      type: "plugin_action_invoked",
      log: { log_id: "L2", status: "failed", stderr: "no pen here\n", exit_code: 2 },
    });
    expect(await plugins.invoke({ plugin: "fence", action: "open" })).toEqual({ status: "failed", output: null, error: "no pen here" });
  });

  it("opens a plugin pane as a tab in the agent's workspace", async () => {
    herdr.handlers["plugin.pane.open"] = (p) => ({
      type: "plugin_pane_opened",
      plugin_pane: { plugin_id: p.plugin_id, entrypoint: p.entrypoint, pane: { pane_id: "w1:p7", workspace_id: "w1" } },
    });
    expect(await plugins.openPane({ plugin: "fence", pane: "tui", paneId: "w1:p1" })).toEqual({ paneId: "w1:p7", workspaceId: "w1" });
    expect(herdr.requests.find((r) => r.method === "plugin.pane.open")!.params).toEqual({
      plugin_id: "fence",
      entrypoint: "tui",
      placement: "tab",
      focus: false,
      workspace_id: "w1",
      target_pane_id: "w1:p1",
    });
    await expect(plugins.openPane({ plugin: "fence", pane: "window" })).rejects.toThrow(/has no pane "window"/);
  });
});

describe("runCardCommand", () => {
  const node = process.execPath;
  const opts = { cwd: tmpdir(), env: { PATH: process.env.PATH ?? "" }, timeoutMs: 5000 };

  it("reads the JSON a command prints", async () => {
    const result = await runCardCommand([node, "-e", 'console.log(JSON.stringify({ rows: [{ kind: "text", value: process.env.SHEPHERD_CARD }] }))'], { ...opts, env: { ...opts.env, SHEPHERD_CARD: "x" } });
    expect(result).toEqual({ ok: true, body: { rows: [{ kind: "text", value: "x" }], buttons: [] } });
  });

  it("explains a crash, a timeout, a missing program and output that isn't a card", async () => {
    expect(await runCardCommand([node, "-e", 'console.error("boom"); process.exit(3)'], opts)).toEqual({ ok: false, error: "The card command exited with code 3: boom" });
    expect(await runCardCommand([node, "-e", "setTimeout(() => {}, 5000)"], { ...opts, timeoutMs: 200 })).toEqual({ ok: false, error: "The card command took longer than 0s." });
    expect((await runCardCommand(["/no/such/program"], opts)) as { error: string }).toMatchObject({ ok: false, error: expect.stringContaining("not found") });
    expect(await runCardCommand([node, "-e", 'console.log("hello")'], opts)).toEqual({ ok: false, error: "The card command didn't print JSON: hello." });
    expect(await runCardCommand([node, "-e", 'console.log("{\\"rows\\": 1}")'], opts)).toEqual({ ok: false, error: '"rows" must be an array.' });
  });
});
