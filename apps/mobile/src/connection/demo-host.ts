// A fake host with realistic agents, for trying the app without a computer
// running shepherd (EXPO_PUBLIC_DEMO=1) and for design previews.
import type {
  ActivityEntry,
  AgentInfo,
  AgentStatus,
  CallMethod,
  ConversationEntry,
  ChangesResult,
  ConversationResult,
  FileDiff,
  FileDiffResult,
  ProjectsResult,
  QueuedMessage,
  StatusChange,
} from "@shepherd/protocol";
import type { ConnectionSettings, HostConnection, HostState, TerminalHandle, TerminalHandlers } from "./host-client";
import { parseAnsi, toStyledLines } from "../agents/ansi";
import { HostCallError } from "./host-client";

/** "1" for a paired demo host; "unpaired" to preview the pairing onboarding. */
export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO;
export const DEMO_ENABLED = DEMO_MODE === "1" || DEMO_MODE === "unpaired";

export const DEMO_SETTINGS: ConnectionSettings = {
  name: "studio-mac",
  urls: ["ws://192.168.1.20:7420/connect", "ws://100.101.102.103:7420/connect"],
  token: "d_demo",
};

function agent(paneId: string, kind: string, status: AgentStatus, title: string, cwd: string, tab = 1): AgentInfo {
  const [workspace] = paneId.split(":");
  return {
    agent: kind,
    agent_status: status,
    focused: false,
    pane_id: paneId,
    tab_id: `${workspace}:t${tab}`,
    workspace_id: workspace!,
    terminal_id: `term_${paneId}`,
    terminal_title_stripped: title,
    cwd,
    foreground_cwd: cwd,
    revision: 1,
  };
}

const AGENTS: AgentInfo[] = [
  agent("w1:p1", "claude", "blocked", "Fix flaky login test", "/Users/demo/code/api"),
  agent("w2:p1", "codex", "working", "Create branch from PR-12", "/Users/demo/code/web"),
  agent("w1:p3", "claude", "done", "Refactor billing module", "/Users/demo/code/api", 3),
  agent("w4:p1", "gemini", "idle", "Ready", "/Users/demo/code/docs"),
];

/** What the agent's edit to the login test changed. */
const LOGIN_EDIT: FileDiff = {
  path: "src/auth/login.test.ts",
  additions: 2,
  deletions: 1,
  hunks: [
    {
      oldStart: 20,
      newStart: 20,
      lines: [
        { kind: "ctx", text: "  it(\"accepts a valid password\", async () => {", old: 20, new: 20 },
        { kind: "ctx", text: "    await form.submit();", old: 21, new: 21 },
        { kind: "del", text: "    expect(session.state).toBe(\"signed-in\");", old: 22 },
        { kind: "add", text: "    await session.flushed;", new: 22 },
        { kind: "add", text: "    expect(session.state).toBe(\"signed-in\");", new: 23 },
        { kind: "ctx", text: "  });", old: 23, new: 24 },
      ],
    },
  ],
};

const CHANGES: ChangesResult = {
  available: true,
  mode: "uncommitted",
  branch: "fix-login-flake",
  base: "main",
  canCompareBranch: true,
  additions: 31,
  deletions: 6,
  files: [
    { path: "src/auth/login.test.ts", status: "modified", additions: 2, deletions: 1, binary: false, generated: false, mention: "src/auth/login.test.ts" },
    { path: "src/auth/signup.test.ts", status: "modified", additions: 4, deletions: 2, binary: false, generated: false, mention: "src/auth/signup.test.ts" },
    { path: "src/auth/session.ts", status: "modified", additions: 25, deletions: 3, binary: false, generated: false, mention: "src/auth/session.ts" },
  ],
};

/** The fix-the-flaky-test conversation, as the host would read it from Claude Code's transcript. */
const CONVERSATION: ConversationEntry[] = [
  { id: 0, kind: "user", text: "The login test fails about one run in five on CI. Can you find out why and fix it?" },
  { id: 1, kind: "thinking", text: "Flaky one in five sounds like timing. Run it a few times locally and look at what the test waits on." },
  { id: 2, kind: "tool", callId: "t1", name: "Bash", summary: "npx vitest run src/auth/login.test.ts --repeat 10" },
  { id: 3, kind: "tool_result", callId: "t1", ok: false, output: "  ✓ login > accepts a valid password (8 runs)\n  × login > accepts a valid password (2 runs)\n    expected 'pending' to be 'signed-in'" },
  { id: 4, kind: "tool", callId: "t2", name: "Read", summary: "src/auth/login.test.ts" },
  { id: 5, kind: "tool_result", callId: "t2", ok: true, output: "…" },
  {
    id: 6,
    kind: "assistant",
    text: "Found it. The test checks the session right after `submit()`, but signing in finishes on the next tick, so it passes or fails depending on timing:\n\n```ts\nawait form.submit();\nexpect(session.state).toBe(\"signed-in\");\n```\n\nI'll wait for the state change instead of assuming it already happened.",
  },
  { id: 7, kind: "tool", callId: "t3", name: "Edit", summary: "src/auth/login.test.ts", diff: LOGIN_EDIT },
  { id: 8, kind: "tool_result", callId: "t3", ok: true, output: "Updated with 2 additions and 1 removal" },
  { id: 9, kind: "user", text: "Nice. Is the signup test flaky for the same reason?" },
  { id: 10, kind: "tool", callId: "t4", name: "Grep", summary: "submit() src/auth" },
  { id: 11, kind: "tool_result", callId: "t4", ok: true, output: "src/auth/signup.test.ts:41\nsrc/auth/login.test.ts:22" },
  { id: 12, kind: "assistant", text: "Yes: `signup.test.ts` makes the same assumption on line 41. Fixing it the same way." },
  { id: 13, kind: "tool", callId: "t5", name: "Edit", summary: "src/auth/signup.test.ts" },
];

/** Waiting in claude's own queue, as the host reads it from the transcript. */
const QUEUED: QueuedMessage[] = [{ text: "Then run the whole auth suite 20 times to be sure" }];

const SNAPSHOT = {
  workspaces: [
    { workspace_id: "w1", label: "api" },
    { workspace_id: "w2", label: "web" },
    { workspace_id: "w4", label: "docs" },
  ],
  tabs: [
    { tab_id: "w1:t1", workspace_id: "w1", number: 1, label: "1" },
    { tab_id: "w1:t2", workspace_id: "w1", number: 2, label: "dev server" },
    { tab_id: "w1:t3", workspace_id: "w1", number: 3, label: "3" },
    { tab_id: "w2:t1", workspace_id: "w2", number: 1, label: "1" },
    { tab_id: "w4:t1", workspace_id: "w4", number: 1, label: "1" },
  ],
  panes: [
    { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", cwd: "/Users/demo/code/api" },
    { pane_id: "w1:p2", tab_id: "w1:t2", workspace_id: "w1", cwd: "/Users/demo/code/api", terminal_title_stripped: "npm run dev" },
    { pane_id: "w1:p3", tab_id: "w1:t3", workspace_id: "w1", cwd: "/Users/demo/code/api" },
    { pane_id: "w2:p1", tab_id: "w2:t1", workspace_id: "w2", cwd: "/Users/demo/code/web" },
    { pane_id: "w4:p1", tab_id: "w4:t1", workspace_id: "w4", cwd: "/Users/demo/code/docs" },
  ],
};

/** A long scrollback, to show scrolling back through the conversation. */
function history(paneId: string): string {
  if (paneId === "w1:p2") {
    return Array.from({ length: 60 }, (_, i) => `\u001b[2m12:0${i % 10}:${String(i).padStart(2, "0")}\u001b[0m GET /api/health \u001b[32m200\u001b[0m ${3 + (i % 7)}ms`).join("\n");
  }
  const turns = [
    "> Look at why the login test is flaky on CI.",
    "\u001b[38;5;78m⏺\u001b[0m Let me start by running the test a few times to reproduce it.",
    "\u001b[38;5;78m⏺\u001b[0m \u001b[1mBash\u001b[0m(npm test -- login --repeat 20)",
    "  ⎿  17 passed, \u001b[31m3 failed\u001b[0m",
    "\u001b[38;5;78m⏺\u001b[0m Reproduced: 3 of 20 runs fail with \u001b[36mexpected 1 cookie, got 0\u001b[0m.",
    "\u001b[38;5;78m⏺\u001b[0m \u001b[1mRead\u001b[0m(src/auth/session.ts)",
    "  ⎿  Read 142 lines",
    "\u001b[38;5;78m⏺\u001b[0m \u001b[36mcreateSession()\u001b[0m resolves before the response headers are flushed.",
  ];
  return Array.from({ length: 6 }, () => turns.join("\n\n")).join("\n\n");
}

const SHELL_SCREEN = [
  "\u001b[2J\u001b[H",
  "\u001b[1;32m➜\u001b[0m api \u001b[2mnpm run dev\u001b[0m\r\n\r\n",
  "  \u001b[1mVITE v6.2.0\u001b[0m  ready in 412 ms\r\n\r\n",
  "  ➜  Local:   \u001b[36mhttp://localhost:5173/\u001b[0m\r\n",
  ...Array.from({ length: 12 }, (_, i) => `\u001b[2m12:10:${String(i).padStart(2, "0")}\u001b[0m GET /api/session \u001b[32m200\u001b[0m ${4 + i}ms\r\n`),
].join("");

const BLOCKED_SCREEN = `⏺ Update(src/auth/login.test.ts)
  ⎿  Updated src/auth/login.test.ts with 3 additions and 1 removal

╭──────────────────────────────────────────────────────────╮
│ Edit file                                                │
│ Do you want to make this edit to login.test.ts?          │
│ ❯ 1. Yes                                                 │
│   2. Yes, allow all edits during this session (shift+tab)│
│   3. No, and tell Claude what to do differently (esc)    │
╰──────────────────────────────────────────────────────────╯
`;

const ESC = "\u001b[";
const TERMINAL_SCREEN = [
  `${ESC}2J${ESC}H`,
  `${ESC}1;38;5;208m✻ Welcome to Claude Code${ESC}0m\r\n\r\n`,
  `${ESC}2m> ${ESC}0mThe login test fails about 1 in 5 runs on CI. Find out why and fix it.\r\n\r\n`,
  `${ESC}38;5;78m⏺${ESC}0m I'll look at the test and the session helper it uses.\r\n\r\n`,
  `${ESC}38;5;78m⏺${ESC}0m ${ESC}1mRead${ESC}0m(src/auth/login.test.ts)\r\n`,
  `  ⎿  Read 84 lines\r\n\r\n`,
  `${ESC}38;5;78m⏺${ESC}0m The test awaits ${ESC}36mcreateSession()${ESC}0m but asserts on the cookie before\r\n`,
  `  the ${ESC}36mSet-Cookie${ESC}0m response is flushed. Under load the assertion runs first.\r\n\r\n`,
  `${ESC}38;5;78m⏺${ESC}0m ${ESC}1mUpdate${ESC}0m(src/auth/login.test.ts)\r\n`,
  `  ⎿  ${ESC}32m+ await session.flushed;${ESC}0m\r\n`,
  `     ${ESC}31m- expect(res.cookies).toHaveLength(1);${ESC}0m\r\n`,
  `     ${ESC}32m+ expect(await res.cookies()).toHaveLength(1);${ESC}0m\r\n\r\n`,
  `${ESC}38;5;244m╭────────────────────────────────────────────╮${ESC}0m\r\n`,
  `${ESC}38;5;244m│${ESC}0m Do you want to make this edit?             ${ESC}38;5;244m│${ESC}0m\r\n`,
  `${ESC}38;5;244m│${ESC}0m ${ESC}36m❯ 1. Yes${ESC}0m                                   ${ESC}38;5;244m│${ESC}0m\r\n`,
  `${ESC}38;5;244m│${ESC}0m   2. Yes, allow all edits this session     ${ESC}38;5;244m│${ESC}0m\r\n`,
  `${ESC}38;5;244m│${ESC}0m   3. No, tell Claude what to change        ${ESC}38;5;244m│${ESC}0m\r\n`,
  `${ESC}38;5;244m╰────────────────────────────────────────────╯${ESC}0m\r\n`,
].join("");

/** A plausible afternoon, newest first. */
function demoActivity(): ActivityEntry[] {
  const MIN = 60_000;
  const now = Date.now();
  const rows: [number, ActivityEntry["event"], ActivityEntry["previous"], AgentInfo][] = [
    [2, "blocked", "working", AGENTS[0]!],
    [9, "working", "idle", AGENTS[1]!],
    [14, "done", "working", AGENTS[2]!],
    [31, "working", "blocked", AGENTS[2]!],
    [52, "blocked", "working", AGENTS[2]!],
    [58, "working", "idle", AGENTS[0]!],
    [66, "working", "idle", AGENTS[2]!],
    [70, "started", null, AGENTS[3]!],
    [26 * 60, "done", "working", AGENTS[1]!],
    [26 * 60 + 40, "working", "idle", AGENTS[1]!],
    [27 * 60, "closed", "done", { ...AGENTS[1]!, pane_id: "w2:p9", terminal_title_stripped: "Bump dependencies" }],
  ];
  return rows.map(([ago, event, previous, a], i) => ({
    id: rows.length - i,
    at: now - ago * MIN,
    event,
    previous,
    paneId: a.pane_id,
    workspaceId: a.workspace_id,
    agent: a.agent ?? null,
    name: null,
    title: a.terminal_title_stripped ?? null,
    cwd: a.cwd ?? null,
  }));
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Behaves like HostClient for the screens, with canned data. */
export class DemoHost implements HostConnection {
  private state: HostState = {
    status: "online",
    error: null,
    host: { name: "studio-mac", herdrVersion: "0.9.1" },
    activeUrl: DEMO_SETTINGS.urls[1]!,
    urls: DEMO_SETTINGS.urls,
    device: { id: "a1b2c3", name: "Pixel 9" },
    agents: AGENTS,
  };
  private listeners = new Set<() => void>();
  private statusListeners = new Set<(c: StatusChange) => void>();

  getState = (): HostState => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onStatusChange(listener: (c: StatusChange) => void) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  start(): void {}
  stop(): void {}
  reconnectNow(): void {}
  checkConnection(): void {}

  async call<T = Record<string, unknown>>(method: CallMethod, params: Record<string, unknown> = {}): Promise<T> {
    switch (method) {
      case "agent.read":
        return { read: { text: params.target === "w1:p1" ? BLOCKED_SCREEN : "Done.\n" } } as T;
      case "agent.list":
        return { agents: this.state.agents } as T;
      case "session.snapshot":
        return { snapshot: SNAPSHOT } as T;
      case "pane.read":
        return { read: { text: history(String(params.pane_id)) } } as T;
      case "pane.send_keys":
      case "pane.send_input":
        return { type: "ok" } as T;
      case "shepherd.conversation": {
        if (params.paneId !== "w1:p1") return { available: false, reason: "No conversation in the demo for this agent." } satisfies ConversationResult as T;
        const after = typeof params.after === "number" ? params.after : -1;
        return {
          available: true,
          agent: "claude",
          session: "demo",
          entries: CONVERSATION.filter((e) => e.id > after),
          first: 0,
          last: CONVERSATION.length - 1,
          queued: QUEUED,
          context: { used: 48_200, window: null },
        } satisfies ConversationResult as T;
      }
      case "shepherd.changes":
        return (params.paneId === "w1:p1" ? CHANGES : { available: false, reason: "No changes in the demo for this agent." }) as T;
      case "shepherd.file_diff":
        return { available: true, diff: { ...LOGIN_EDIT, path: String(params.path) } } satisfies FileDiffResult as T;
      case "shepherd.activity":
        return { entries: (params as { before?: number }).before ? [] : demoActivity() } as T;
      case "shepherd.start_agent":
        return { paneId: "w1:p2", workspaceId: "w1", ready: true } as T;
      case "shepherd.projects":
        return {
          kinds: ["claude", "codex", "gemini"],
          projects: [
            { workspaceId: "w1", label: "api", cwd: "/Users/demo/code/api", repoName: "api" },
            { workspaceId: "w2", label: "web", cwd: "/Users/demo/code/web", repoName: "web" },
            { workspaceId: "w4", label: "docs", cwd: "/Users/demo/code/docs", repoName: null },
          ],
        } satisfies ProjectsResult as T;
      case "agent.send_keys":
      case "agent.prompt":
        this.setStatus(String(params.target), "working");
        return { type: "ok" } as T;
      default:
        throw new HostCallError("demo", `${method} isn't available in demo mode`);
    }
  }

  openTerminal(paneId: string, opts: { cols?: number; rows?: number; render?: string }, handlers: TerminalHandlers): TerminalHandle {
    const screen = paneId === "w1:p2" ? SHELL_SCREEN : TERMINAL_SCREEN;
    const width = opts.cols ?? 60;
    const height = opts.rows ?? 24;
    const timer = setTimeout(() => {
      if (opts.render === "lines") {
        // The host would emulate the terminal; the canned screen is plain enough to parse.
        const rows = toStyledLines(parseAnsi(screen.replace(/\u001b\[2J|\u001b\[H/g, "")));
        const lines: Record<string, (typeof rows)[number]> = {};
        for (let y = 0; y < height; y++) lines[y] = rows[y] ?? [];
        handlers.onLines?.({ type: "terminal.lines", streamId: "demo", width, height, cursor: { x: 0, y: Math.min(rows.length, height - 1), visible: false }, lines, full: true });
      } else {
        handlers.onFrame?.({ type: "terminal.frame", streamId: "demo", seq: 1, full: true, width, height, bytes: base64(screen) });
      }
    }, 50);
    return { input: () => {}, scroll: () => {}, close: () => clearTimeout(timer) };
  }

  private setStatus(paneId: string, status: AgentStatus): void {
    const previous = this.state.agents.find((a) => a.pane_id === paneId);
    if (!previous || previous.agent_status === status) return;
    const updated = { ...previous, agent_status: status, revision: previous.revision + 1 };
    this.state = { ...this.state, agents: this.state.agents.map((a) => (a.pane_id === paneId ? updated : a)) };
    for (const l of this.listeners) l();
    for (const l of this.statusListeners) l({ type: "agent.status", paneId, status, previous: previous.agent_status, agent: updated });
  }
}
