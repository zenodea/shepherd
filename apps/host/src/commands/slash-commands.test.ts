import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fakeAgent } from "../testing/fake-herdr.ts";
import { defaultHomes } from "../conversation/vendors/index.ts";
import { frontMatter, SlashCommands } from "./slash-commands.ts";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup() {
  const home = mkdtempSync(join(tmpdir(), "shepherd-cmds-"));
  dirs.push(home);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(home, path)), { recursive: true });
    writeFileSync(join(home, path), text);
  };
  const commands = new SlashCommands({ homes: defaultHomes({}, home), home, configHome: join(home, ".config") });
  const list = (agent: string, cwd = join(home, "Work", "app")) => {
    const result = commands.list(fakeAgent("w1:p1", "idle", { agent, cwd }));
    if (!result.available) throw new Error(result.reason);
    return result.commands;
  };
  return { home, write, list };
}

describe("frontMatter", () => {
  it("reads key: value pairs, quoted and folded, and the text after them", () => {
    expect(frontMatter('---\nname: grill-me\ndescription: >\n  Grill the user\n  relentlessly.\nargument-hint: "[plan]"\n---\nBody')).toEqual({
      fields: { name: "grill-me", description: "Grill the user relentlessly.", "argument-hint": "[plan]" },
      body: "Body",
    });
    expect(frontMatter("No front matter")).toEqual({ fields: {}, body: "No front matter" });
  });
});

describe("SlashCommands", () => {
  it("lists built-ins first, then your own commands and skills, for the agent's kind and project", () => {
    const { write, list } = setup();
    write(".claude/commands/ship.md", "---\ndescription: Ship it\nargument-hint: [version]\n---\nDo the release.");
    write(".claude/commands/git/sync.md", "Pull, rebase and push.");
    write(".claude/skills/grill-me/SKILL.md", "---\nname: grill-me\ndescription: Grill the user about a plan.\n---\n");
    write(".claude/skills/hidden/SKILL.md", "---\nname: hidden\ndescription: Model only.\nuser-invocable: false\n---\n");
    write(".claude/skills/synced/abc/pdf/SKILL.md", "---\nname: pdf\ndescription: Work with PDFs.\n---\n");
    write(".claude/skills/bundle/inner/SKILL.md", "---\nname: inner\ndescription: Not loaded by Claude.\n---\n");
    write("Work/.claude/commands/review.md", "---\ndescription: Our own review\n---\n");
    write("Work/.claude/commands/compact.md", "---\ndescription: Our compact\n---\n");

    const claude = list("claude");
    expect(claude[0]).toMatchObject({ name: "/add-dir" });
    expect(claude.length).toBeGreaterThan(80);
    expect(claude.find((c) => c.name === "/compact")).toEqual({ name: "/compact", description: "Our compact" });
    expect(claude.filter((c) => c.name === "/compact")).toHaveLength(1);
    expect(claude.find((c) => c.name === "/context")).toMatchObject({ opens: "terminal" });
    expect(claude.find((c) => c.name === "/model")).toMatchObject({ opens: "model" });
    expect(claude.slice(-5)).toEqual([
      { name: "/git:sync", description: "Pull, rebase and push." },
      { name: "/ship", description: "Ship it", hint: "version" },
      { name: "/grill-me", description: "Grill the user about a plan." },
      { name: "/pdf", description: "Work with PDFs." },
      { name: "/review", description: "Our own review" },
    ]);
  });

  it("names Codex prompts, pi prompts and skills, Gemini and OpenCode commands the way each agent does", () => {
    const { write, list } = setup();
    write(".codex/prompts/explain.md", "---\ndescription: Explain code\n---\n");
    write(".pi/agent/prompts/workflow.md", "---\ndescription: Multi-agent workflow\nargument-hint: \"[task]\"\n---\n");
    write(".agents/skills/find-skills/SKILL.md", "---\nname: find-skills\ndescription: Find skills.\n---\n");
    write(".gemini/commands/git/commit.toml", 'description = "Write a commit message"\nprompt = "..."\n');
    write(".config/opencode/command/test.md", "---\ndescription: Run the tests\n---\n");

    expect(list("codex").at(-1)).toEqual({ name: "/prompts:explain", description: "Explain code" });
    expect(list("pi").slice(-2)).toEqual([
      { name: "/workflow", description: "Multi-agent workflow", hint: "task" },
      { name: "/skill:find-skills", description: "Find skills." },
    ]);
    expect(list("gemini").at(-1)).toEqual({ name: "/git:commit", description: "Write a commit message" });
    expect(list("opencode").at(-1)).toEqual({ name: "/test", description: "Run the tests" });
    expect(list("hermes")).toEqual([]);
    expect(list("pi").some((c) => c.name === "/hotkeys")).toBe(true);
  });

  it("reads pi extensions' commands from their source: npm, local and loose extensions", () => {
    const { write, list } = setup();
    write(".pi/agent/settings.json", JSON.stringify({ packages: ["npm:@x/pi-goal@1.2.0", "./vendor/todo"] }));
    write(
      ".pi/agent/npm/node_modules/@x/pi-goal/src/index.ts",
      `pi.registerCommand("goal", {\n  handler: async () => {\n${"    work();\n".repeat(80)}  },\n  description: "Run a goal to completion",\n});\npi.registerCommand('goal-status', { description: 'Show the goal' });`,
    );
    write(".pi/agent/vendor/todo/index.js", 'pi.registerCommand(`todos`, { description: "Show all todos" })');
    write(".pi/agent/vendor/todo/skills/plan-it/SKILL.md", "---\nname: plan-it\ndescription: Plan it.\n---\n");
    write(".pi/agent/extensions/mine.ts", 'export default (pi) => pi.registerCommand("hello", { description: "Say hello" });');
    write(".pi/agent/npm/node_modules/@x/pi-goal/test/x.test.ts", 'pi.registerCommand("nope", {})');

    const names = list("pi").map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["/goal", "/goal-status", "/todos", "/hello", "/skill:plan-it"]));
    expect(names).not.toContain("/nope");
    expect(list("pi").find((c) => c.name === "/goal")).toEqual({ name: "/goal", description: "Run a goal to completion" });
  });

  it("has nothing for a pane that isn't an agent", () => {
    expect(new SlashCommands().list(null)).toMatchObject({ available: false });
  });
});
