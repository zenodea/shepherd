import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HerdrClient } from "./herdr-client.ts";
import { FolderError, Folders } from "./folders.ts";
import { Launcher, LaunchError } from "./launcher.ts";
import { FakeHerdr } from "../testing/fake-herdr.ts";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function home() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "shepherd-home-")));
  dirs.push(root);
  for (const dir of ["Work/api/.git", "Work/web/.git", "Work/notes", ".secret", "Documents", "node_modules/x"]) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "Work", "file.txt"), "not a folder");
  return root;
}

describe("folders", () => {
  it("lists a folder's subfolders, never hidden ones or files, and suggests repos and recent folders", () => {
    const root = home();
    const folders = new Folders(root);
    const first = folders.list(undefined, [join(root, "Work", "notes"), "/etc", join(root, "Work", "notes")]);
    expect(first).toMatchObject({ path: root, parent: null });
    expect(first.folders.map((f) => f.name)).toEqual(["Documents", "Work"]);
    expect(first.suggestions?.recent.map((f) => f.name)).toEqual(["notes"]);
    expect(first.suggestions?.repos.map((f) => f.name).sort()).toEqual(["api", "web"]);
    const work = folders.list("~/Work", []);
    expect(work).toMatchObject({ path: join(root, "Work"), parent: root });
    expect(work.folders).toEqual([
      { name: "api", path: join(root, "Work", "api"), repo: true },
      { name: "notes", path: join(root, "Work", "notes"), repo: false },
      { name: "web", path: join(root, "Work", "web"), repo: true },
    ]);
    expect(work.suggestions).toBeUndefined();
  });

  it("only allows existing folders inside your home folder", () => {
    const root = home();
    const folders = new Folders(root);
    expect(folders.resolve("~/Work/api")).toBe(join(root, "Work", "api"));
    expect(() => folders.resolve("/etc")).toThrow(FolderError);
    expect(() => folders.resolve(`${root}/../`)).toThrow(/inside your home/);
    expect(() => folders.resolve("~/Work/missing")).toThrow(/isn't a folder/);
    expect(() => folders.resolve("~/Work/file.txt")).toThrow(/isn't a folder/);
    expect(() => folders.resolve("Work/api")).toThrow(/full path/);
  });

  it("starts an agent in a new workspace for the folder", async () => {
    const root = home();
    const herdr = new FakeHerdr();
    await herdr.listen();
    const client = new HerdrClient(herdr.socketPath, 1000);
    try {
      herdr.handlers["server.agent_manifests"] = () => ({ type: "agent_manifest_status", manifests: [{ agent: "claude" }] });
      herdr.handlers["workspace.create"] = () => ({ type: "workspace_created", root_pane: { pane_id: "w7:p1", workspace_id: "w7", tab_id: "w7:t1" } });
      herdr.handlers["agent.start"] = () => ({ type: "agent_started" });
      const launcher = new Launcher({ herdr: client, installed: () => true, folders: new Folders(root) });
      await expect(launcher.start({ kind: "claude", folder: "~/Work/api" })).resolves.toEqual({ paneId: "w7:p1", workspaceId: "w7", ready: true });
      expect(herdr.requests.find((r) => r.method === "workspace.create")?.params).toEqual({ cwd: join(root, "Work", "api"), label: "api", focus: false });
      await expect(launcher.start({ kind: "claude", folder: "/etc" })).rejects.toBeInstanceOf(LaunchError);
      await expect(launcher.start({ kind: "claude", folder: "~/Work/api", newWorktree: true })).rejects.toThrow(/existing workspace/);
    } finally {
      client.close();
      await herdr.close();
    }
  });
});
