import { accessSync, constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { delimiter, join } from "node:path";
import { TERMINAL_KIND, type Project, type ProjectsResult, type StartAgentParams, type StartAgentResult } from "@sheperd/protocol";
import { HerdrRequestError, type HerdrClient } from "./herdr-client.ts";

/** Shown first in the app; everything else herdr supports follows alphabetically. */
const PREFERRED_KINDS = ["claude", "codex", "gemini", "opencode", "cursor", "copilot", "amp"];
const START_TIMEOUT_MS = 60_000;
const PROMPT_WAIT_MS = 5 * 60_000;
const MAX_PROMPT_LENGTH = 20_000;

type Snapshot = {
  workspaces: { workspace_id: string; label: string; worktree?: { repo_name?: string; checkout_path?: string } | null }[];
  panes: { pane_id: string; workspace_id: string; tab_id: string; cwd?: string | null; focused?: boolean }[];
};

type CreatedPane = { root_pane: { pane_id: string; workspace_id: string; tab_id: string } };

export class LaunchError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Default: search PATH like a shell would. */
export function isOnPath(name: string, path = process.env.PATH ?? ""): boolean {
  return path
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => {
      try {
        accessSync(join(dir, name), constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

export function sortKinds(kinds: string[]): string[] {
  const rank = (k: string) => {
    const i = PREFERRED_KINDS.indexOf(k);
    return i === -1 ? PREFERRED_KINDS.length : i;
  };
  return [...kinds].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Starts new agents on behalf of the app, only ever as a supported agent kind
 * in the directory of an existing herdr workspace.
 */
export class Launcher {
  private readonly herdr: HerdrClient;
  private readonly installed: (name: string) => boolean;
  private readonly onError: (err: Error) => void;

  constructor(opts: { herdr: HerdrClient; installed?: (name: string) => boolean; onError?: (err: Error) => void }) {
    this.herdr = opts.herdr;
    this.installed = opts.installed ?? ((name) => isOnPath(name));
    this.onError = opts.onError ?? (() => {});
  }

  async projects(): Promise<ProjectsResult> {
    const [kinds, snapshot] = await Promise.all([this.kinds(), this.snapshot()]);
    const projects: Project[] = snapshot.workspaces.map((ws) => ({
      workspaceId: ws.workspace_id,
      label: ws.label,
      cwd: workspaceCwd(snapshot, ws.workspace_id),
      repoName: ws.worktree?.repo_name ?? null,
    }));
    return { kinds, projects };
  }

  async start(params: StartAgentParams): Promise<StartAgentResult> {
    const { kind, workspaceId, newWorktree = false, prompt } = params;
    if (typeof kind !== "string" || typeof workspaceId !== "string") throw new LaunchError("invalid_params", "kind and workspaceId are required");
    if (prompt !== undefined && (typeof prompt !== "string" || prompt.length > MAX_PROMPT_LENGTH)) {
      throw new LaunchError("invalid_params", "prompt must be a string");
    }
    const terminal = kind === TERMINAL_KIND;
    if (!terminal && !(await this.kinds()).includes(kind)) throw new LaunchError("unknown_kind", `${kind} is not installed on this computer`);

    const snapshot = await this.snapshot();
    if (!snapshot.workspaces.some((ws) => ws.workspace_id === workspaceId)) {
      throw new LaunchError("unknown_workspace", "That workspace no longer exists");
    }

    const created = newWorktree
      ? await this.herdr.request<CreatedPane>("worktree.create", { workspace_id: workspaceId, focus: false })
      : await this.herdr.request<CreatedPane & { tab: { tab_id: string } }>("tab.create", {
          workspace_id: workspaceId,
          cwd: workspaceCwd(snapshot, workspaceId),
          label: terminal ? null : kind,
          focus: false,
        });
    const pane = created.root_pane;

    if (terminal) {
      if (prompt?.trim()) {
        await this.herdr.request("pane.send_input", { pane_id: pane.pane_id, text: prompt, keys: ["enter"] }).catch((err: Error) => this.onError(err));
      }
      return { paneId: pane.pane_id, workspaceId: pane.workspace_id, ready: true };
    }

    let ready = true;
    try {
      await this.herdr.request("agent.start", {
        name: `${kind}-${randomBytes(2).toString("hex")}`,
        kind,
        pane_id: pane.pane_id,
        timeout_ms: START_TIMEOUT_MS,
      });
    } catch (err) {
      // Started, but waiting on the user first (e.g. "trust this folder?").
      if (err instanceof HerdrRequestError && err.code === "agent_not_ready") {
        ready = false;
      } else {
        if (!newWorktree) await this.herdr.request("tab.close", { tab_id: pane.tab_id }).catch(() => {});
        throw err;
      }
    }

    if (prompt?.trim()) void this.sendWhenReady(pane.pane_id, prompt, ready);
    return { paneId: pane.pane_id, workspaceId: pane.workspace_id, ready };
  }

  private async sendWhenReady(paneId: string, prompt: string, ready: boolean): Promise<void> {
    try {
      if (!ready) await this.herdr.request("agent.wait", { target: paneId, until: ["idle"], timeout_ms: PROMPT_WAIT_MS });
      await this.herdr.request("agent.prompt", { target: paneId, text: prompt });
    } catch (err) {
      this.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async kinds(): Promise<string[]> {
    const result = await this.herdr.request<{ manifests: { agent: string }[] }>("server.agent_manifests");
    return sortKinds([...new Set(result.manifests.map((m) => m.agent))].filter((k) => /^[a-z0-9_-]+$/.test(k) && this.installed(k)));
  }

  private async snapshot(): Promise<Snapshot> {
    const result = await this.herdr.request<{ snapshot: Snapshot }>("session.snapshot");
    return result.snapshot;
  }
}

/** A workspace's directory: its worktree checkout, else its focused or first pane's cwd. */
function workspaceCwd(snapshot: Snapshot, workspaceId: string): string | null {
  const ws = snapshot.workspaces.find((w) => w.workspace_id === workspaceId);
  if (ws?.worktree?.checkout_path) return ws.worktree.checkout_path;
  const panes = snapshot.panes.filter((p) => p.workspace_id === workspaceId && p.cwd);
  return (panes.find((p) => p.focused) ?? panes[0])?.cwd ?? null;
}
