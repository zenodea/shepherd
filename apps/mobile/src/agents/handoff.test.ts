import { describe, expect, it } from "vitest";
import type { HandoffResult, Project } from "@shepherd/protocol";
import { defaultTarget, leftBehind, matchingProject } from "./handoff";

type Handoff = Extract<HandoffResult, { available: true }>;

const handoff = (repo: Partial<NonNullable<Handoff["repo"]>> | null, cwd = "/Users/me/code/shepherd"): Handoff => ({
  available: true,
  from: "desk",
  agent: "claude",
  cwd,
  brief: "",
  repo: repo && { name: "shepherd", branch: "main", commit: "abc1234", subject: "s", remote: null, unpushed: 0, uncommitted: { count: 0, files: [] }, ...repo },
});

const projects: Project[] = [
  { workspaceId: "w1", label: "api", cwd: "/home/me/api", repoName: null },
  { workspaceId: "w2", label: "shep", cwd: "/home/me/src/shepherd/", repoName: null },
  { workspaceId: "w3", label: "wt", cwd: "/home/me/.wt/x", repoName: "shepherd" },
];

describe("handoff", () => {
  it("matches a repository herdr knows, then a folder with the same name", () => {
    expect(matchingProject(projects, handoff({}))?.workspaceId).toBe("w3");
    expect(matchingProject(projects.slice(0, 2), handoff({}))?.workspaceId).toBe("w2");
    expect(matchingProject(projects, handoff(null, "/x/api"))?.workspaceId).toBe("w1");
    expect(matchingProject(projects, handoff(null, "/x/nothing"))).toBeNull();
  });

  it("goes to another computer that's online, else stays", () => {
    expect(defaultTarget([{ id: "a", online: true }, { id: "b", online: false }, { id: "c", online: true }], "a")).toBe("c");
    expect(defaultTarget([{ id: "a", online: true }, { id: "b", online: false }], "a")).toBe("a");
  });

  it("says what stays behind", () => {
    expect(leftBehind(handoff({}))).toBeNull();
    expect(leftBehind(handoff({ unpushed: 1, uncommitted: { count: 3, files: [] } }))).toBe(
      "Only on desk: 3 uncommitted files and 1 unpushed commit. Commit and push first if the other computer needs them.",
    );
  });
});
