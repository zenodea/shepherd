// The "/" commands an agent understands, for suggestions while you type one:
// all of its built-ins (names and wording from its own "/" menu), and your own
// commands, prompts, skills and pi extensions' commands, read from their files.
// Whether one is worth running is up to you.
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import type { AgentInfo, CommandsResult, SlashCommand } from "@shepherd/protocol";
import { defaultHomes, type VendorHomes } from "../conversation/vendors/index.ts";

const terminal = "terminal" as const;

// Every built-in an agent's own "/" menu lists (Claude Code, Codex and pi, read
// from the menus themselves), with `opens` on the ones that draw a screen.
const BUILT_IN: Record<string, SlashCommand[]> = {
  claude: [
    { name: "/add-dir", description: "Add a new working directory", hint: "path" },
    { name: "/advisor", description: "Let Claude consult a stronger model at key moments" },
    { name: "/artifacts", description: "Browse your published and shared artifacts", opens: "terminal" },
    { name: "/auto-mode-setup", description: "Teach auto mode about your environment, plus optional rule tweaks", opens: "terminal" },
    { name: "/autocompact", description: "Set how full the context gets before auto-summarizing", hint: "percent" },
    { name: "/autofix-pr", description: "Monitor and autofix any issues with the current PR" },
    { name: "/background", description: "Send this session to the background and free the terminal" },
    { name: "/branch", description: "Create a branch of the current conversation at this point" },
    { name: "/btw", description: "Ask a quick side question without interrupting the main conversation", hint: "question" },
    { name: "/bug", description: "Report a bug or share your conversation", opens: "terminal" },
    { name: "/cd", description: "Move this session to a new working directory", hint: "path" },
    { name: "/chrome", description: "Open Claude in Chrome settings", opens: "terminal" },
    { name: "/clear", description: "Start a new session with empty context; previous session stays on disk (resumable with /resume)" },
    { name: "/color", description: "Set the prompt bar color for this session", opens: "terminal" },
    { name: "/compact", description: "Free up context by summarizing the conversation so far" },
    { name: "/config", description: "Open settings", opens: "terminal" },
    { name: "/context", description: "Visualize current context usage as a colored grid", opens: "terminal" },
    { name: "/copy", description: "Copy Claude's last response to clipboard (or /copy N for the Nth-latest)", hint: "N", opens: "terminal" },
    { name: "/dataviz", description: "Use this skill whenever you are about to create ANY chart, graph, plot, dashboard, or data visualiz\u2026" },
    { name: "/design-login", description: "Authorize design-system access for /design-sync with your claude.ai account", opens: "terminal" },
    { name: "/desktop", description: "Continue the current session in Claude Desktop", opens: "terminal" },
    { name: "/diff", description: "View uncommitted changes and per-turn diffs", opens: "terminal" },
    { name: "/effort", description: "Set effort level for model usage", hint: "low | medium | high | xhigh | max" },
    { name: "/exit", description: "Exit the CLI" },
    { name: "/export", description: "Export the current conversation to a file or clipboard", opens: "terminal" },
    { name: "/fast", description: "Toggle fast mode (Opus 5.5)" },
    { name: "/feedback", description: "Send feedback to Anthropic or report a bug", opens: "terminal" },
    { name: "/fewer-permission-prompts", description: "Allowlist the read-only commands you keep approving" },
    { name: "/focus", description: "Toggle focus view: just your prompt, summary, and response" },
    { name: "/fork", description: "Copy this conversation into a new background session and keep working here" },
    { name: "/goal", description: "Set a goal Claude checks before stopping", hint: "goal" },
    { name: "/help", description: "Show help and available commands", opens: "terminal" },
    { name: "/hooks", description: "View hook configurations for tool events", opens: "terminal" },
    { name: "/ide", description: "Manage IDE integrations and show status", opens: "terminal" },
    { name: "/import", description: "Import config from another AI coding agent", opens: "terminal" },
    { name: "/init", description: "Set up a CLAUDE.md file for this project" },
    { name: "/install-github-app", description: "Set up Claude GitHub Actions for a repository", opens: "terminal" },
    { name: "/install-slack-app", description: "Install the Claude Slack app", opens: "terminal" },
    { name: "/keybindings", description: "Open your keyboard shortcuts file", opens: "terminal" },
    { name: "/list-agents", description: "List subagents, teammates, and other Claude sessions you can message", opens: "terminal" },
    { name: "/login", description: "Sign in with your Anthropic account", opens: "terminal" },
    { name: "/logout", description: "Sign out from your Anthropic account", opens: "terminal" },
    { name: "/loop", description: "Run a prompt or command on a recurring interval", hint: "interval and prompt" },
    { name: "/mcp", description: "Manage MCP servers", opens: "terminal" },
    { name: "/memory", description: "Edit CLAUDE.md files and memory settings", opens: "terminal" },
    { name: "/mobile", description: "Show QR code to download the Claude mobile app", opens: "terminal" },
    { name: "/model", description: "Set the AI model for Claude Code", opens: "model" },
    { name: "/output-style", description: "List output styles or switch to one", opens: "terminal" },
    { name: "/passes", description: "Share a free week of Claude Code with friends and earn usage credits", opens: "terminal" },
    { name: "/permissions", description: "Manage allow and deny tool permission rules", opens: "terminal" },
    { name: "/plan", description: "Enable plan mode or view the current session plan" },
    { name: "/plugin", description: "Manage Claude Code plugins", opens: "terminal" },
    { name: "/powerup", description: "Discover Claude Code features through quick interactive lessons", opens: "terminal" },
    { name: "/privacy-settings", description: "View and update your privacy settings", opens: "terminal" },
    { name: "/radio", description: "Listen to Claude FM lo-fi radio", opens: "terminal" },
    { name: "/rate-limit-options", description: "Manage usage limits and upgrade options", opens: "terminal" },
    { name: "/recap", description: "Generate a one-line session recap now" },
    { name: "/release-notes", description: "View release notes", opens: "terminal" },
    { name: "/reload-plugins", description: "Activate pending plugin changes in the current session" },
    { name: "/reload-skills", description: "Pick up skills added or changed on disk during this session" },
    { name: "/remote-control", description: "Control this session from your phone or claude.ai/code", opens: "terminal" },
    { name: "/remote-env", description: "Choose the default environment for cloud agents", opens: "terminal" },
    { name: "/rename", description: "Rename the current conversation", hint: "name" },
    { name: "/resume", description: "Resume a previous conversation", opens: "terminal" },
    { name: "/rewind", description: "Restore the code and/or conversation to a previous point", opens: "terminal" },
    { name: "/run", description: "Launch and drive this project's app to see a change working. Use when asked to run, start, or scree\u2026" },
    { name: "/sandbox", description: "Configure the sandbox", opens: "terminal" },
    { name: "/security-review", description: "Review the pending changes on this branch for security issues" },
    { name: "/simplify", description: "Review the changed code for reuse, simplification and efficiency, then fix it" },
    { name: "/skill-doctor", description: "Show which loaded skills are unused and costing context", opens: "terminal" },
    { name: "/skills", description: "List available skills", opens: "terminal" },
    { name: "/status", description: "Show Claude Code status including version, model, account, API connectivity, and tool statuses", opens: "terminal" },
    { name: "/stickers", description: "Order Claude Code stickers", opens: "terminal" },
    { name: "/subtask", description: "Send a subagent off with your full context; its result comes back here", hint: "task" },
    { name: "/tasks", description: "View and manage everything running in the background", opens: "terminal" },
    { name: "/teleport", description: "Send this session to the cloud, or resume one from claude.ai", opens: "terminal" },
    { name: "/terminal-setup", description: "Check terminal setup (Shift+Enter is natively supported in Ghostty)", opens: "terminal" },
    { name: "/theme", description: "Change the theme", opens: "terminal" },
    { name: "/tui", description: "Set the terminal UI renderer (default or fullscreen)", opens: "terminal" },
    { name: "/ultrareview", description: "Start a cloud agent that finds and verifies bugs in your branch" },
    { name: "/upgrade", description: "Upgrade to Max for higher rate limits and more Opus", opens: "terminal" },
    { name: "/usage", description: "Show session cost, plan usage, and activity stats", opens: "terminal" },
    { name: "/usage-credits", description: "Configure usage credits or request them from your admin when you hit a limit", opens: "terminal" },
    { name: "/voice", description: "Toggle voice mode", opens: "terminal" },
    { name: "/web-setup", description: "Set up cloud sessions with your GitHub account", opens: "terminal" },
    { name: "/workflows", description: "Browse running and completed workflows", opens: "terminal" },
  ],
  codex: [
    { name: "/agents", description: "Open the agent command center", opens: "terminal" },
    { name: "/app", description: "Continue this session in the Desktop app", opens: "terminal" },
    { name: "/approve", description: "Approve one retry of a recent auto-review denial" },
    { name: "/archive", description: "Archive this session", opens: "terminal" },
    { name: "/cd", description: "Change the current working directory", hint: "path" },
    { name: "/clear", description: "Clear the terminal and start a new chat" },
    { name: "/compact", description: "Summarize conversation to prevent hitting the context limit" },
    { name: "/copy", description: "Copy the last response or part of it", opens: "terminal" },
    { name: "/daemon", description: "Manage the local background server", opens: "terminal" },
    { name: "/delete", description: "Permanently delete this session", opens: "terminal" },
    { name: "/diff", description: "Show git diff (including untracked files)", opens: "terminal" },
    { name: "/exit", description: "Exit Codex" },
    { name: "/experimental", description: "Toggle experimental features", opens: "terminal" },
    { name: "/export", description: "Export the conversation as markdown" },
    { name: "/fast", description: "2x speed, increased usage" },
    { name: "/feedback", description: "Send logs to maintainers" },
    { name: "/fork", description: "Fork the current chat" },
    { name: "/goal", description: "Set or view the goal for a long-running task", hint: "goal" },
    { name: "/hooks", description: "View and manage lifecycle hooks", opens: "terminal" },
    { name: "/ide", description: "Include current selection, open files, and other context from your IDE", opens: "terminal" },
    { name: "/import", description: "Import setup, this project, and recent chats from Claude Code" },
    { name: "/init", description: "Create an AGENTS.md file with instructions for Codex" },
    { name: "/keymap", description: "Remap TUI shortcuts", opens: "terminal" },
    { name: "/logout", description: "Log out of Codex", opens: "terminal" },
    { name: "/mcp", description: "List configured MCP tools; use /mcp verbose for details", opens: "terminal" },
    { name: "/memories", description: "Configure memory use and generation", opens: "terminal" },
    { name: "/mention", description: "Mention a file", opens: "terminal" },
    { name: "/model", description: "Choose what model and reasoning effort to use", opens: "model" },
    { name: "/new", description: "Start a new chat during a conversation" },
    { name: "/permissions", description: "Choose what Codex is allowed to do", opens: "terminal" },
    { name: "/pets", description: "Choose or hide the terminal pet", opens: "terminal" },
    { name: "/plan", description: "Switch to Plan mode" },
    { name: "/plugins", description: "Browse plugins", opens: "terminal" },
    { name: "/ps", description: "List background terminals", opens: "terminal" },
    { name: "/pwd", description: "Show the current working directory" },
    { name: "/raw", description: "Toggle raw scrollback mode for copy-friendly terminal selection" },
    { name: "/recap", description: "Summarize the current conversation now" },
    { name: "/rename", description: "Rename the current thread", hint: "name" },
    { name: "/resume", description: "Resume a saved chat", opens: "terminal" },
    { name: "/review", description: "Review my current changes and find issues", opens: "terminal" },
    { name: "/side", description: "Start a side conversation in an ephemeral fork", hint: "question" },
    { name: "/skills", description: "Use skills to improve how Codex performs specific tasks", opens: "terminal" },
    { name: "/status", description: "Show current session configuration and token usage", opens: "terminal" },
    { name: "/statusline", description: "Configure which items appear in the status line", opens: "terminal" },
    { name: "/stop", description: "Stop all background terminals" },
    { name: "/subagents", description: "Switch between this session's subagents", opens: "terminal" },
    { name: "/theme", description: "Choose a syntax highlighting theme", opens: "terminal" },
    { name: "/title", description: "Configure which items appear in the terminal title", opens: "terminal" },
    { name: "/tui", description: "Choose the TUI mode for the next launch", opens: "terminal" },
    { name: "/vim", description: "Toggle Vim mode for the composer" },
    { name: "/voice", description: "Start or stop voice; use /voice settings to choose a voice", opens: "terminal" },
    { name: "/warnings", description: "View retained warnings and diagnostic details", opens: "terminal" },
    { name: "/worktree", description: "Start or continue a conversation in a new worktree", opens: "terminal" },
  ],
  pi: [
    { name: "/bug", description: "Report a bug to the Pi developers", hint: "description" },
    { name: "/changelog", description: "Show changelog entries", opens: "terminal" },
    { name: "/clone", description: "Duplicate the current session at the current position" },
    { name: "/compact", description: "Manually compact the session context" },
    { name: "/copy", description: "Copy last agent message to clipboard" },
    { name: "/export", description: "Export session (HTML default, or specify path: .html/.jsonl)", hint: "path" },
    { name: "/fork", description: "Create a new fork from a previous user message", opens: "terminal" },
    { name: "/hotkeys", description: "Show all keyboard shortcuts", opens: "terminal" },
    { name: "/import", description: "Import and resume a session from a JSONL file", opens: "terminal" },
    { name: "/llama", description: "Manage llama.cpp router models", opens: "terminal" },
    { name: "/login", description: "Configure provider authentication", hint: "provider", opens: "terminal" },
    { name: "/logout", description: "Remove provider authentication", opens: "terminal" },
    { name: "/mcp", description: "Manage MCP servers: sign in, reconnect, enable or disable, and change exposure", opens: "terminal" },
    { name: "/model", description: "Select model (opens selector UI)", opens: "model" },
    { name: "/name", description: "Set session display name", hint: "name" },
    { name: "/new", description: "Start a new session" },
    { name: "/quit", description: "Quit pi" },
    { name: "/reload", description: "Reload keybindings, extensions, skills, prompts, themes, and context files" },
    { name: "/resume", description: "Resume a different session", opens: "terminal" },
    { name: "/scoped-models", description: "Enable/disable models for Ctrl+P cycling", opens: "terminal" },
    { name: "/session", description: "Show session info and stats", opens: "terminal" },
    { name: "/settings", description: "Open settings menu", opens: "terminal" },
    { name: "/share", description: "Share session as a secret GitHub gist" },
    { name: "/thinking", description: "Set thinking level", hint: "level" },
    { name: "/tree", description: "Navigate session tree (switch branches)", opens: "terminal" },
    { name: "/trust", description: "Save project trust decision for future sessions" },
    { name: "/workflow", description: "[task or instructions] \u2014 [u] Explore, implement, test, and review with a multi-agent workflow", opens: "terminal" },
  ],
  // From their docs (not read from their own menus).
  gemini: [
    { name: "/about", description: "Show version info", opens: terminal },
    { name: "/auth", description: "Change the authentication method", opens: terminal },
    { name: "/bug", description: "File an issue about Gemini CLI", hint: "description" },
    { name: "/chat", description: "Save, resume or list conversation checkpoints", hint: "save | resume | list  tag" },
    { name: "/clear", description: "Clear the screen and conversation history" },
    { name: "/compress", description: "Replace the chat context with a summary" },
    { name: "/copy", description: "Copy the last output to the clipboard" },
    { name: "/directory", description: "Manage workspace directories", hint: "add | show  path", opens: terminal },
    { name: "/docs", description: "Open the documentation", opens: terminal },
    { name: "/editor", description: "Choose an editor", opens: terminal },
    { name: "/extensions", description: "List active extensions", opens: terminal },
    { name: "/help", description: "Show help", opens: terminal },
    { name: "/ide", description: "Manage IDE integration", opens: terminal },
    { name: "/init", description: "Create a GEMINI.md file for this project" },
    { name: "/mcp", description: "List MCP servers and tools", opens: terminal },
    { name: "/memory", description: "Show, add to or refresh memory", hint: "show | add | refresh" },
    { name: "/privacy", description: "Show the privacy notice", opens: terminal },
    { name: "/quit", description: "Exit Gemini CLI" },
    { name: "/restore", description: "Restore files to before a tool ran", opens: terminal },
    { name: "/settings", description: "Open settings", opens: terminal },
    { name: "/stats", description: "Show session statistics", opens: terminal },
    { name: "/theme", description: "Change the theme", opens: terminal },
    { name: "/tools", description: "List available tools", opens: terminal },
    { name: "/vim", description: "Toggle vim mode" },
  ],
  opencode: [
    { name: "/compact", description: "Compact the session" },
    { name: "/details", description: "Toggle tool execution details" },
    { name: "/editor", description: "Open an external editor to write a message", opens: terminal },
    { name: "/exit", description: "Exit OpenCode" },
    { name: "/export", description: "Export the conversation to Markdown", opens: terminal },
    { name: "/help", description: "Show help", opens: terminal },
    { name: "/init", description: "Create or update AGENTS.md" },
    { name: "/models", description: "List and pick a model", opens: terminal },
    { name: "/new", description: "Start a new session" },
    { name: "/redo", description: "Redo the last undone message" },
    { name: "/sessions", description: "List and switch sessions", opens: terminal },
    { name: "/share", description: "Share the session" },
    { name: "/themes", description: "List themes", opens: terminal },
    { name: "/undo", description: "Undo the last message" },
    { name: "/unshare", description: "Stop sharing the session" },
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

/** Skills: folders holding a SKILL.md, named by their `name` or the folder; a couple of levels deeper too (Claude keeps synced skills in skills/synced/<id>/). */
function skills(dir: string, prefix: string, deeper = 2): SlashCommand[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((folder) => {
    if (folder.startsWith(".")) return [];
    const path = join(dir, folder, "SKILL.md");
    const text = head(path);
    // Only Claude's synced skills sit deeper (synced/<id>/<skill>); other nested folders aren't loaded by the agents.
    if (text === null) return deeper > 0 && (folder === "synced" || deeper === 1) && isDir(join(dir, folder)) ? skills(join(dir, folder), prefix, deeper - 1) : [];
    const command = fromMarkdown(`${prefix}${frontMatter(text).fields.name || folder}`, path);
    return command ? [command] : [];
  });
}

const REGISTERED = /registerCommand\(\s*["'`]([\w:.-]+)["'`]/g;
const DESCRIPTION = /description:\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/;
const MAX_SOURCE = 512 * 1024;
const EXTENSIONS_EVERY_MS = 5 * 60_000;
let extensionCache: { key: string; at: number; commands: SlashCommand[] } | null = null;

/** Where pi's packages live: npm ones under <home>/npm, git ones under <home>/git, paths relative to <home>. */
function piPackageDirs(piHome: string): string[] {
  let packages: unknown;
  try {
    packages = (JSON.parse(readFileSync(join(piHome, "settings.json"), "utf8")) as { packages?: unknown }).packages;
  } catch {
    return [];
  }
  if (!Array.isArray(packages)) return [];
  return packages.flatMap((spec) => {
    if (typeof spec !== "string") return [];
    if (spec.startsWith("npm:")) return [join(piHome, "npm", "node_modules", spec.slice(4).replace(/(?<=.)@[^/@]*$/, ""))];
    if (spec.startsWith("git:")) return [join(piHome, "git", spec.slice(4).replace(/@[^/@]*$/, ""))];
    return [join(piHome, spec)];
  });
}

/** Commands pi extensions register (`pi.registerCommand("name", { description })`), read from their source. */
function piExtensionCommands(piHome: string): SlashCommand[] {
  const dirs = [join(piHome, "extensions"), ...piPackageDirs(piHome)];
  const key = dirs.join("\0");
  if (extensionCache?.key === key && Date.now() - extensionCache.at < EXTENSIONS_EVERY_MS) return extensionCache.commands;
  const found = new Map<string, SlashCommand>();
  const read = (path: string) => {
    try {
      if (statSync(path).size > MAX_SOURCE) return;
      const source = readFileSync(path, "utf8");
      if (!source.includes("registerCommand")) return;
      for (const m of source.matchAll(REGISTERED)) {
        const name = `/${m[1]}`;
        // Its options follow the name: the description is near, before the next command.
        const options = source.slice(m.index + m[0].length, m.index + 1500).split("registerCommand(")[0]!;
        if (!found.has(name)) found.set(name, { name, description: oneLine(DESCRIPTION.exec(options)?.[2] ?? "") });
      }
    } catch {
      // unreadable: skip it
    }
  };
  const visit = (dir: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith(".") || name === "node_modules" || name === "test" || name === "tests" || name.endsWith(".d.ts")) continue;
      const path = join(dir, name);
      if (/\.(?:ts|js|mjs)$/.test(name) && !/\.test\./.test(name)) read(path);
      else if (depth > 0 && isDir(path)) visit(path, depth - 1);
    }
  };
  for (const dir of dirs) visit(dir, 3);
  // Packages bring skills too.
  const commands = [...found.values(), ...piPackageDirs(piHome).flatMap((dir) => skills(join(dir, "skills"), "/skill:", 0))];
  extensionCache = { key, at: Date.now(), commands };
  return commands;
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
        ...piExtensionCommands(homes.pi),
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

