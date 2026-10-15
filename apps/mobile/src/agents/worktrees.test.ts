import { describe, expect, it } from "vitest";
import type { AgentInfo, AgentStatus } from "@shepherd/protocol";
import { foldedWorktrees, worktreesOf, worktreesPill, worktreesRunning } from "./worktrees";

const agent = (pane_id: string, agent_status: AgentStatus, git?: AgentInfo["git"]): AgentInfo =>
  ({ pane_id, agent_status, focused: false, tab_id: "t", workspace_id: "w", terminal_id: "x", revision: 0, ...(git ? { git } : {}) }) as AgentInfo;
const main = (repo: string) => ({ repo, worktree: false, branch: null });
const wt = (repo: string, branch: string) => ({ repo, worktree: true, branch });

const lead = agent("p1", "idle", main("/code/bundle"));
const ui = agent("p2", "working", wt("/code/bundle", "pack/ui"));
const db = agent("p3", "done", wt("/code/bundle", "pack/db"));
const orphan = agent("p4", "working", wt("/code/other", "fix"));
const plain = agent("p5", "idle");
const agents = [lead, ui, db, orphan, plain];

describe("worktrees", () => {
  it("lists a main-checkout agent's worktrees, and none for a worktree agent", () => {
    expect(worktreesOf(lead, agents).map((a) => a.pane_id)).toEqual(["p2", "p3"]);
    expect(worktreesOf(ui, agents)).toEqual([]);
    expect(worktreesOf(plain, agents)).toEqual([]);
  });

  it("folds worktree agents only when their main checkout has an agent", () => {
    expect([...foldedWorktrees(agents)]).toEqual(["p2", "p3"]);
  });

  it("counts working worktrees on the badge while the agent itself isn't working", () => {
    expect(worktreesRunning(lead, agents)).toBe(1);
    expect(worktreesRunning({ ...lead, agent_status: "working" }, agents)).toBe(0);
  });

  it("words the pill like the subagents one", () => {
    expect(worktreesPill([ui, db])).toBe("1 worktree running");
    expect(worktreesPill([db])).toBe("1 worktree");
    expect(worktreesPill([])).toBeNull();
  });
});
