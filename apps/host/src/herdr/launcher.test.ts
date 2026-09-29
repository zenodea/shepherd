import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HerdrClient } from "./herdr-client.ts";
import { Launcher, sortKinds } from "./launcher.ts";
import { FakeHerdr, until } from "../testing/fake-herdr.ts";

describe("Launcher", () => {
  let herdr: FakeHerdr;
  let client: HerdrClient;
  let launcher: Launcher;
  let errors: Error[];

  beforeEach(async () => {
    herdr = new FakeHerdr();
    await herdr.listen();
    client = new HerdrClient(herdr.socketPath, 1000);
    errors = [];
    launcher = new Launcher({
      herdr: client,
      installed: (name) => ["claude", "codex", "zed-agent"].includes(name),
      onError: (e) => errors.push(e),
    });
    herdr.handlers["server.agent_manifests"] = () => ({
      type: "agent_manifest_status",
      manifests: [{ agent: "zed-agent" }, { agent: "codex" }, { agent: "gemini" }, { agent: "claude" }],
    });
    herdr.handlers["session.snapshot"] = () => ({
      type: "session_snapshot",
      snapshot: {
        workspaces: [
          { workspace_id: "w1", label: "api" },
          { workspace_id: "w2", label: "worktree-x", worktree: { repo_name: "api", checkout_path: "/wt/x" } },
        ],
        panes: [
          { pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", cwd: "/code/api", focused: false },
          { pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1", cwd: "/code/api/src", focused: true },
          { pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1", cwd: "/elsewhere" },
        ],
      },
    });
    herdr.handlers["tab.create"] = (p) => ({
      type: "tab_created",
      tab: { tab_id: "w1:t9" },
      root_pane: { pane_id: "w1:p9", workspace_id: p.workspace_id, tab_id: "w1:t9" },
    });
    herdr.handlers["worktree.create"] = () => ({
      type: "worktree_created",
      root_pane: { pane_id: "w5:p1", workspace_id: "w5", tab_id: "w5:t1" },
    });
    herdr.handlers["agent.start"] = () => ({ type: "agent_started" });
    herdr.handlers["agent.prompt"] = () => ({ type: "ok" });
    herdr.handlers["agent.wait"] = () => ({ type: "agent_wait" });
    herdr.handlers["tab.close"] = () => ({ type: "ok" });
  });

  afterEach(async () => {
    client.close();
    await herdr.close();
  });

  const calls = (method: string) => herdr.requests.filter((r) => r.method === method).map((r) => r.params);

  it("lists installed kinds (popular first) and workspace directories", async () => {
    expect(await launcher.projects()).toEqual({
      kinds: ["claude", "codex", "zed-agent"],
      projects: [
        { workspaceId: "w1", label: "api", cwd: "/code/api/src", repoName: null },
        { workspaceId: "w2", label: "worktree-x", cwd: "/wt/x", repoName: "api" },
      ],
    });
  });

  it("starts an agent in a new tab in the workspace's directory", async () => {
    const result = await launcher.start({ kind: "claude", workspaceId: "w1" });
    expect(result).toEqual({ paneId: "w1:p9", workspaceId: "w1", ready: true });
    expect(calls("tab.create")).toEqual([{ workspace_id: "w1", cwd: "/code/api/src", label: "claude", focus: false }]);
    expect(calls("agent.start")[0]).toMatchObject({ kind: "claude", pane_id: "w1:p9" });
    expect(calls("agent.prompt")).toEqual([]);
  });

  it("can start in a new git worktree", async () => {
    const result = await launcher.start({ kind: "codex", workspaceId: "w1", newWorktree: true });
    expect(result.paneId).toBe("w5:p1");
    expect(calls("worktree.create")).toEqual([{ workspace_id: "w1", focus: false }]);
    expect(calls("tab.create")).toEqual([]);
  });

  it("sends the first prompt once the agent is ready", async () => {
    await launcher.start({ kind: "claude", workspaceId: "w1", prompt: "fix the tests" });
    await until(() => calls("agent.prompt").length === 1);
    expect(calls("agent.prompt")).toEqual([{ target: "w1:p9", text: "fix the tests" }]);
    expect(calls("agent.wait")).toEqual([]);
  });

  it("waits for a blocked agent (e.g. a trust prompt) before prompting", async () => {
    herdr.errorFor = (method) => (method === "agent.start" ? { code: "agent_not_ready", message: "blocked" } : null);
    const result = await launcher.start({ kind: "claude", workspaceId: "w1", prompt: "hi" });
    expect(result.ready).toBe(false);
    await until(() => calls("agent.prompt").length === 1);
    expect(calls("agent.wait")[0]).toMatchObject({ target: "w1:p9", until: ["idle"] });
  });

  it("closes the new tab if the agent fails to start", async () => {
    herdr.errorFor = (method) => (method === "agent.start" ? { code: "agent_start_failed", message: "no shell" } : null);
    await expect(launcher.start({ kind: "claude", workspaceId: "w1" })).rejects.toMatchObject({ code: "agent_start_failed" });
    expect(calls("tab.close")).toEqual([{ tab_id: "w1:t9" }]);
  });

  it("refuses kinds that aren't installed and unknown workspaces", async () => {
    await expect(launcher.start({ kind: "gemini", workspaceId: "w1" })).rejects.toMatchObject({ code: "unknown_kind" });
    await expect(launcher.start({ kind: "bash", workspaceId: "w1" })).rejects.toMatchObject({ code: "unknown_kind" });
    await expect(launcher.start({ kind: "claude", workspaceId: "w404" })).rejects.toMatchObject({ code: "unknown_workspace" });
    expect(calls("tab.create")).toEqual([]);
  });
});

describe("sortKinds", () => {
  it("puts popular agents first", () => {
    expect(sortKinds(["zzz", "codex", "aaa", "claude"])).toEqual(["claude", "codex", "aaa", "zzz"]);
  });
});
