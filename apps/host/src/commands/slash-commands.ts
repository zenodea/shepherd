// The "/" commands an agent understands, for suggestions while you type one:
// a short list of its useful built-ins (names and wording from its own "/"
// menu), and your own commands, prompts and skills, read from their files.
// Commands extensions and plugins add while running aren't in any file; you
// can still type those.
import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import type { AgentInfo, CommandsResult, SlashCommand } from "@shepherd/protocol";
import { defaultHomes, type VendorHomes } from "../conversation/vendors/index.ts";

const terminal = "terminal" as const;

const BUILT_IN: Record<string, SlashCommand[]> = {
  claude: [
    { name: "/clear", description: "Start a new session with empty context" },
    { name: "/compact", description: "Free up context by summarizing the conversation so far" },
    { name: "/context", description: "Visualize current context usage", opens: terminal },
    { name: "/usage", description: "Show session cost, plan usage, and activity stats", opens: terminal },
    { name: "/diff", description: "View uncommitted changes and per-turn diffs", opens: terminal },
    { name: "/model", description: "Set the AI model", opens: "model" },
    { name: "/effort", description: "Set effort level for model usage", hint: "low | medium | high | xhigh | max" },
    { name: "/plan", description: "Enable plan mode or view the current session plan" },
    { name: "/btw", description: "Ask a quick side question without interrupting", hint: "question" },
    { name: "/goal", description: "Set a goal Claude checks before stopping", hint: "goal" },
    { name: "/recap", description: "Generate a one-line session recap now" },
    { name: "/rename", description: "Rename the current conversation", hint: "name" },
    { name: "/resume", description: "Resume a previous conversation", opens: terminal },
    { name: "/rewind", description: "Restore the code and/or conversation to a previous point", opens: terminal },
    { name: "/status", description: "Show version, model, account and connectivity", opens: terminal },
  ],
  codex: [
    { name: "/new", description: "Start a new chat during a conversation" },
    { name: "/compact", description: "Summarize conversation to prevent hitting the context limit" },
    { name: "/review", description: "Review my current changes and find issues", opens: terminal },
    { name: "/diff", description: "Show git diff (including untracked files)", opens: terminal },
    { name: "/status", description: "Show current session configuration and token usage", opens: terminal },
    { name: "/model", description: "Choose what model and reasoning effort to use", opens: "model" },
    { name: "/plan", description: "Switch to Plan mode" },
    { name: "/goal", description: "Set or view the goal for a long-running task", hint: "goal" },
    { name: "/recap", description: "Summarize the current conversation now" },
    { name: "/rename", description: "Rename the current thread", hint: "name" },
    { name: "/fork", description: "Fork the current chat" },
    { name: "/resume", description: "Resume a saved chat", opens: terminal },
    { name: "/init", description: "Create an AGENTS.md file with instructions for Codex" },
  ],
  pi: [
    { name: "/new", description: "Start a new session" },
    { name: "/compact", description: "Manually compact the session context" },
    { name: "/model", description: "Select model", opens: "model" },
    { name: "/thinking", description: "Set thinking level", hint: "level" },
    { name: "/name", description: "Set session display name", hint: "name" },
    { name: "/session", description: "Show session info and stats", opens: terminal },
    { name: "/resume", description: "Resume a different session", opens: terminal },
    { name: "/tree", description: "Navigate session tree (switch branches)", opens: terminal },
    { name: "/fork", description: "Create a new fork from a previous user message", opens: terminal },
    { name: "/reload", description: "Reload keybindings, extensions, skills, prompts and themes" },
    { name: "/settings", description: "Open settings menu", opens: terminal },
  ],
  gemini: [
    { name: "/clear", description: "Clear the screen and conversation history" },
    { name: "/compress", description: "Replace the chat context with a summary" },
    { name: "/stats", description: "Show session statistics", opens: terminal },
    { name: "/tools", description: "List available tools", opens: terminal },
    { name: "/mcp", description: "List MCP servers and tools", opens: terminal },
  ],
  opencode: [
    { name: "/new", description: "Start a new session" },
    { name: "/compact", description: "Compact the session" },
    { name: "/undo", description: "Undo the last message" },
    { name: "/redo", description: "Redo the last undone message" },
    { name: "/models", description: "List and pick a model", opens: terminal },
    { name: "/sessions", description: "List and switch sessions", opens: terminal },
    { name: "/init", description: "Create or update AGENTS.md" },
  ],
};

const HEAD_BYTES = 4096;
const MAX_COMMANDS = 300;
const CACHE_MS = 30_000;

/** The first few KB of a file, or null. */
function head(path: string): string | null {
  try {
    const fd = openSync(path, "r");
    try {
      const buffer = Buffer.alloc(HEAD_BYTES);
      return buffer.toString("utf8", 0, readSync(fd, buffer, 0, HEAD_BYTES, 0));
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** `key: value` pairs from YAML front matter (folded `>` and `|` values joined), and the text after it. */
export function frontMatter(text: string): { fields: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  let key: string | null = null;
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = /^([\w-]+):\s*(.*)$/.exec(line);
    if (pair) {
      key = pair[1]!;
      fields[key] = /^[>|][+-]?$/.test(pair[2]!) ? "" : pair[2]!.replace(/^(["'])(.*)\1$/, "$2");
    } else if (key && /^\s+\S/.test(line)) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
    }
  }
  return { fields, body: text.slice(match[0].length) };
}

/** One line, short enough for a row on a phone. */
function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

/** A command from a markdown file: its description and argument hint from front matter, else its first line. */
function fromMarkdown(name: string, path: string): SlashCommand | null {
  const text = head(path);
  if (text === null) return null;
  const { fields, body } = frontMatter(text);
  if (fields["user-invocable"] === "false") return null;
  const description = oneLine(fields.description || body.split("\n").find((l) => l.trim() && !l.startsWith("#")) || "");
  const hint = oneLine(fields["argument-hint"] ?? "").replace(/^\[(.*)\]$/, "$1");
  return { name, description, ...(hint ? { hint } : {}) };
}

/** Files with `extension` under `dir`, a few folders deep, as [path, name relative to dir with ":" between folders]. */
function filesIn(dir: string, extension: string, depth = 3): [string, string][] {
  const out: [string, string][] = [];
  const visit = (at: string, left: number) => {
    let names: string[];
    try {
      names = readdirSync(at);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const path = join(at, name);
      if (name.endsWith(extension)) out.push([path, relative(dir, path).slice(0, -extension.length).split(sep).join(":")]);
      else if (left > 0 && isDir(path)) visit(path, left - 1);
    }
  };
  visit(dir, depth);
  return out;
}

const isDir = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Skills: folders holding a SKILL.md, named by their `name` or the folder. */
function skills(dir: string, prefix: string): SlashCommand[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((folder) => {
    const path = join(dir, folder, "SKILL.md");
    const name = frontMatter(head(path) ?? "").fields.name || folder;
    const command = fromMarkdown(`${prefix}${name}`, path);
    return command ? [command] : [];
  });
}

/** The agent's folder and the ones above it, up to (not including) your home folder: where project commands live. */
function projectDirs(cwd: string | null | undefined, home: string): string[] {
  const dirs: string[] = [];
  for (let dir = cwd ?? ""; dir.startsWith(home + sep) && dirs.length < 8; dir = dirname(dir)) dirs.push(dir);
  return dirs;
}

function custom(kind: string, homes: VendorHomes, projects: string[], home: string, configHome: string): SlashCommand[] {
  const markdown = (dir: string, prefix = "/") => filesIn(dir, ".md").flatMap(([path, name]) => fromMarkdown(`${prefix}${name}`, path) ?? []);
  switch (kind) {
    case "claude":
      return [homes.claude, ...projects.map((p) => join(p, ".claude"))].flatMap((dir) => [...markdown(join(dir, "commands")), ...skills(join(dir, "skills"), "/")]);
    case "codex":
      return markdown(join(homes.codex, "prompts"), "/prompts:");
    case "pi":
      return [
        ...[homes.pi, ...projects.map((p) => join(p, ".pi"))].flatMap((dir) => markdown(join(dir, "prompts"))),
        ...[join(homes.pi, "skills"), join(home, ".agents", "skills"), ...projects.flatMap((p) => [join(p, ".pi", "skills"), join(p, ".agents", "skills")])].flatMap((dir) => skills(dir, "/skill:")),
      ];
    case "gemini":
      return [homes.gemini, ...projects.map((p) => join(p, ".gemini"))].flatMap((dir) =>
        filesIn(join(dir, "commands"), ".toml").map(([path, name]) => ({ name: `/${name}`, description: oneLine(/^description\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(head(path) ?? "")?.[1] ?? "") })),
      );
    case "opencode":
      return [join(configHome, "opencode"), ...projects.map((p) => join(p, ".opencode"))].flatMap((dir) => [...markdown(join(dir, "command")), ...markdown(join(dir, "commands"))]);
    default:
      return [];
  }
}

export class SlashCommands {
  private readonly homes: VendorHomes;
  private readonly home: string;
  private readonly configHome: string;
  private cache = new Map<string, { at: number; commands: SlashCommand[] }>();

  constructor({ homes = defaultHomes(), home = homedir(), configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config") } = {}) {
    this.homes = homes;
    this.home = home;
    this.configHome = configHome;
  }

  list(agent: AgentInfo | null): CommandsResult {
    const kind = agent?.agent;
    if (!agent || !kind) return { available: false, reason: "Only agents take / commands." };
    const cwd = agent.foreground_cwd ?? agent.cwd;
    const key = `${kind}\0${cwd}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) return { available: true, commands: cached.commands };

    // Built-ins first, so a bare "/" suggests them; your own command wins over a built-in of the same name, as in the agents.
    const own = custom(kind, this.homes, projectDirs(cwd, this.home), this.home, this.configHome);
    const ownByName = new Map(own.map((c) => [c.name, c]));
    const seen = new Set<string>();
    const commands = [...(BUILT_IN[kind] ?? []).map((c) => ownByName.get(c.name) ?? c), ...own]
      .filter((c) => !seen.has(c.name) && seen.add(c.name))
      .slice(0, MAX_COMMANDS);
    if (this.cache.size > 50) this.cache.clear();
    this.cache.set(key, { at: Date.now(), commands });
    return { available: true, commands };
  }
}

