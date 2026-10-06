// A fake host with realistic agents, for trying the app without a computer
// running shepherd (EXPO_PUBLIC_DEMO=1) and for design previews.
import type {
  ActivityEntry,
  AgentInfo,
  AgentStatus,
  CallMethod,
  CardsResult,
  PluginActionResult,
  PluginPaneResult,
  PluginsResult,
  ConversationEntry,
  ChangesResult,
  ConversationResult,
  FileDiff,
  FileDiffResult,
  FoldersResult,
  ModelResult,
  ImageResult,
  ImagesResult,
  Subagent,
  SubagentsResult,
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

/** A second paired computer in the demo, to show every computer on one screen. */
export const DEMO_LAPTOP_SETTINGS: ConnectionSettings = {
  name: "work-laptop",
  urls: ["ws://192.168.1.31:7420/connect"],
  token: "d_demo_laptop",
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
  { ...agent("w1:p1", "claude", "blocked", "Fix flaky login test", "/Users/demo/code/api"), last_done_at: Date.now() - 41 * 60_000 },
  { ...agent("w2:p1", "codex", "working", "Create branch from PR-12", "/Users/demo/code/web"), last_done_at: Date.now() - 3 * 3600_000 },
  { ...agent("w1:p3", "claude", "done", "Refactor billing module", "/Users/demo/code/api", 3), last_done_at: Date.now() - 2 * 60_000, subagents_running: 1 },
  agent("w4:p1", "gemini", "idle", "Ready", "/Users/demo/code/docs"),
];

const LAPTOP_AGENTS: AgentInfo[] = [
  agent("w1:p1", "claude", "blocked", "Add retries to the payments webhook", "/Users/demo/code/payments"),
  { ...agent("w2:p1", "codex", "working", "Write the release notes", "/Users/demo/code/site"), last_done_at: Date.now() - 18 * 60_000 },
];

const LAPTOP_SNAPSHOT = {
  workspaces: [
    { workspace_id: "w1", label: "payments" },
    { workspace_id: "w2", label: "site" },
  ],
  tabs: [
    { tab_id: "w1:t1", workspace_id: "w1", number: 1, label: "1" },
    { tab_id: "w2:t1", workspace_id: "w2", number: 1, label: "1" },
  ],
  panes: [
    { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", cwd: "/Users/demo/code/payments" },
    { pane_id: "w2:p1", tab_id: "w2:t1", workspace_id: "w2", cwd: "/Users/demo/code/site" },
  ],
};

const LAPTOP_BLOCKED_SCREEN = `⏺ Bash(npm run test:webhooks)

╭──────────────────────────────────────────────────────────╮
│ Bash command                                             │
│   npm run test:webhooks                                  │
│ Do you want to proceed?                                  │
│ ❯ 1. Yes                                                 │
│   2. Yes, and don't ask again for npm run commands       │
│   3. No, and tell Claude what to do differently (esc)    │
╰──────────────────────────────────────────────────────────╯
`;

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

const ctx = (n: number, text: string) => ({ kind: "ctx" as const, text, old: n, new: n });
const SESSION_EDIT: FileDiff = {
  path: "src/auth/session.ts",
  additions: 7,
  deletions: 2,
  hunks: [
    {
      oldStart: 1,
      newStart: 1,
      lines: [
        ctx(1, 'import { EventEmitter } from "node:events";'),
        ctx(2, 'import type { User } from "./user";'),
        ctx(3, ""),
        { kind: "del", text: "const FLUSH_TIMEOUT_MS = 2000;", old: 4 },
        { kind: "add", text: "const FLUSH_TIMEOUT_MS = 5000;", new: 4 },
        ctx(5, ""),
        ctx(6, "export class Session extends EventEmitter {"),
        ctx(7, '  state: "pending" | "signed-in" | "signed-out" = "pending";'),
        ctx(8, "  user: User | null = null;"),
        ctx(9, ""),
        ctx(10, "  constructor(private readonly store: Storage) {"),
        ctx(11, "    super();"),
        ctx(12, "  }"),
        ctx(13, ""),
        ctx(14, "  async signIn(user: User): Promise<void> {"),
        ctx(15, "    this.user = user;"),
        { kind: "del", text: '    this.state = "signed-in";', old: 16 },
        { kind: "add", text: '    // Wait for the token to be written before anyone reads the state.', new: 16 },
        { kind: "add", text: "    await this.flush();", new: 17 },
        { kind: "add", text: '    this.state = "signed-in";', new: 18 },
        { kind: "add", text: '    this.emit("change", this.state);', new: 19 },
        { kind: "ctx", text: "  }", old: 17, new: 20 },
        { kind: "ctx", text: "", old: 18, new: 21 },
        { kind: "add", text: "  /** Resolves once the session is on disk. */", new: 22 },
        { kind: "add", text: "  get flushed(): Promise<void> {", new: 23 },
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
  additions: 32,
  deletions: 6,
  files: [
    { path: "src/auth/login.test.ts", status: "modified", additions: 2, deletions: 1, binary: false, generated: false, mention: "src/auth/login.test.ts" },
    { path: "src/auth/signup.test.ts", status: "modified", additions: 4, deletions: 2, binary: false, generated: false, mention: "src/auth/signup.test.ts" },
    { path: "src/auth/session.ts", status: "modified", additions: 7, deletions: 2, binary: false, generated: false, mention: "src/auth/session.ts" },
    { path: "src/auth/flush.ts", status: "added", additions: 18, deletions: 0, binary: false, generated: false, mention: "src/auth/flush.ts" },
    { path: "README.md", status: "modified", additions: 1, deletions: 1, binary: false, generated: false, mention: "README.md" },
    { path: "package-lock.json", status: "modified", additions: 40, deletions: 12, binary: false, generated: true, mention: "package-lock.json" },
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

const DEMO_SUBAGENTS: Subagent[] = [
  { id: "s-imports", name: "Check every billing import still resolves", kind: "Explore", depth: 1, status: "done", startedAt: new Date(Date.now() - 9 * 60_000).toISOString(), updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(), toolCalls: 23, doing: null },
  { id: "s-docs", name: "Update the billing docs", kind: "general-purpose", depth: 1, status: "running", startedAt: new Date(Date.now() - 2 * 60_000).toISOString(), updatedAt: null, toolCalls: 7, doing: "Edit docs/billing/invoices.md" },
];

const SUBAGENT_CONVERSATION: ConversationEntry[] = [
  { id: 0, kind: "user", text: "Update docs/billing/ for the new module layout: invoices, tax and export each get their own page." },
  { id: 1, kind: "tool", callId: "d1", name: "Glob", summary: "docs/billing/**/*.md" },
  { id: 2, kind: "tool_result", callId: "d1", ok: true, output: "docs/billing/index.md\ndocs/billing/invoices.md" },
  { id: 3, kind: "assistant", text: "Two pages so far. I'll split **invoices.md** and add `tax.md`." },
  { id: 4, kind: "tool", callId: "d2", name: "Edit", summary: "docs/billing/invoices.md" },
];

/** A small generated picture, standing in for a screenshot the agent read. */
const DEMO_IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAPAAAACWCAIAAABvmpKCAAA0AElEQVR42uzSg5Gl3QIAwD+IN7Zt27Zt296dWfMG9oX1TnUYW1PVIfR//2uNgjjiSSCRJJJJIZU00skgkyyyyWmNBbnkkU8BhRRRTAmllFFOBZVUUd0aBTXUUkc9DTTSRDMttNJGOx100tUaC7rpoZc++hlgkCGGGWGUMcaZYLI1CqaYZoZZ5phngUWWWGaFVdZYZ6M1FmyyxTY77LLHPgcccsQxJ5xyxnlrFFxwyRXX3HDLHfc88MgTz7zwgY+tseCVNz7xmS985Rvf+cFPfvGbP/zlv/fQ76H/rdBtURBHPAkkkkQyKaSSRjoZZJJFNjltsSCXPPIpoJAiiimhlDLKqaCSKqrboqCGWuqop4FGmmimhVbaaKeDTrraYkE3PfTSRz8DDDLEMCOMMsY4E0y2RcEU08wwyxzzLLDIEsussMoa62y0xYJNtthmh1322OeAQ4445oRTzjhvi4ILLrnimhtuueOeBx554pkXPvCxLRa88sYnPvOFr3zjOz/4yS9+84e/vId+D/2PhW6PgjjiSSCRJJJJIZU00skgkyyyyWmPBbnkkU8BhRRRTAmllFFOBZVUUd0eBTXUUkc9DTTSRDMttNJGOx100tUeC7rpoZc++hlgkCGGGWGUMcaZYLI9CqaYZoZZ5phngUWWWGaFVdZYZ6M9FmyyxTY77LLHPgcccsQxJ5xyxnl7FFxwyRXX3HDLHfc88MgTz7zwgY/tseCVNz7xmS985Rvf+cFPfvGbP/zlPfR76H8sdEcUxBFPAokkkUwKqaSRTgaZZJFNTkcsyCWPfAoopIhiSiiljHIqqKSK6o4oqKGWOuppoJEmmmmhlTba6aCTro5Y0E0PvfTRzwCDDDHMCKOMMc4Ekx1RMMU0M8wyxzwLLLLEMiusssY6Gx2xYJMtttlhlz32OeCQI4454ZQzzjui4IJLrrjmhlvuuOeBR5545oUPfOyIBa+88YnPfOEr3/jOD37yi9/84S/vod9D/2OhO6MgjngSSCSJZFJIJY10Msgki2xyOmNBLnnkU0AhRRRTQilllFNBJVVUd0ZBDbXUUU8DjTTRTAuttNFOB510dcaCbnropY9+BhhkiGFGGGWMcSaY7IyCKaaZYZY55llgkSWWWWGVNdbZ6IwFm2yxzQ677LHPAYccccwJp5xx3hkFF1xyxTU33HLHPQ888sQzL3zgY2cseOWNT3zmC1/5xnd+8JNf/OYPf3kP/R76HwvdFQVxxJNAIkkkk0IqaaSTQSZZZJPTFQtyySOfAgopopgSSimjnAoqqaK6KwpqqKWOehpopIlmWmiljXY66KSrKxZ000MvffQzwCBDDDPCKGOMM8FkVxRMMc0Ms8wxzwKLLLHMCqussc5GVyzYZIttdthlj30OOOSIY0445Yzzrii44JIrrrnhljvueeCRJ5554QMfu2LBK2984jNf+Mo3vvODn/ziN3/4y3vo99D/WOjuKIgjngQSSSKZFFJJI50MMskim5zuWJBLHvkUUEgRxZRQShnlVFBJFdXdUVBDLXXU00AjTTTTQitttNNBJ13dsaCbHnrpo58BBhlimBFGGWOcCSa7o2CKaWaYZY55FlhkiWVWWGWNdTa6Y8EmW2yzwy577HPAIUccc8IpZ5x3R8EFl1xxzQ233HHPA4888cwLH/jYHQteeeMTn/nCV77xnR/85Be/+cNf3kO/h/7HQvdEQRzxJJBIEsmkkEoa6WSQSRbZ5PTEglzyyKeAQooopoRSyiingkqqqO6JghpqqaOeBhppopkWWmmjnQ466eqJBd300Esf/QwwyBDDjDDKGONMMNkTBVNMM8Msc8yzwCJLLLPCKmuss9ETCzbZYpsddtljnwMOOeKYE04547wnCi645IprbrjljnseeOSJZ174wMeeWPDKG5/4zBe+8o3v/OAnv/jNH/7yHvo99D8WujcK4ogngUSSSCaFVNJIJ4NMssgmpzcW5JJHPgUUUkQxJZRSRjkVVFJFdW8U1FBLHfU00EgTzbTQShvtdNBJV28s6KaHXvroZ4BBhhhmhFHGGGeCyd4omGKaGWaZY54FFllimRVWWWOdjd5YsMkW2+ywyx77HHDIEceccMoZ571RcMElV1xzwy133PPAI08888IHPvbGglfe+MRnvvCVb3znBz/5xW/+8Jf30O+h/7HQfVEQRzwJJJJEMimkkkY6GWSSRTY5fbEglzzyKaCQIoopoZQyyqmgkiqq+6KghlrqqKeBRppopoVW2ming066+mJBNz300kc/AwwyxDAjjDLGOBNM9kXBFNPMMMsc8yywyBLLrLDKGuts9MWCTbbYZodd9tjngEOOOOaEU84474uCCy65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";

/** A long, tool-heavy session (the refactor agent), paged like the real host, to try scrolling far back. */
const LONG_CONVERSATION: ConversationEntry[] = (() => {
  const out: ConversationEntry[] = [];
  let id = 0;
  for (let turn = 1; turn <= 8; turn++) {
    out.push({ id: id++, kind: "user", text: `Step ${turn}: move the next part of billing into its own module.` });
    for (let t = 0; t < 45; t++) {
      const callId = `l${turn}-${t}`;
      out.push({ id: id++, kind: "tool", callId, name: t % 3 ? "Read" : "Edit", summary: `src/billing/part${turn}-${t}.ts` });
      out.push({ id: id++, kind: "tool_result", callId, ok: true, output: "ok" });
      if (t % 15 === 14) out.push({ id: id++, kind: "assistant", text: `Moved ${t + 1} files for step ${turn} so far.` });
    }
    out.push({ id: id++, kind: "assistant", text: `Step ${turn} is done.` });
  }
  out.push({ id: id++, kind: "tool", callId: "spawn-tests", name: "Agent", summary: "Check every billing import still resolves", subagent: "s-imports" });
  out.push({ id: id++, kind: "tool_result", callId: "spawn-tests", ok: true, output: "All 214 imports resolve." });
  out.push({ id: id++, kind: "tool", callId: "spawn-docs", name: "Agent", summary: "Update the billing docs", subagent: "s-docs" });
  out.push({ id: id++, kind: "tool", callId: "shot", name: "Read", summary: "screenshots/billing.png" });
  out.push({ id: id++, kind: "tool_result", callId: "shot", ok: true, output: "[image]", images: [{ id: "1:0", mime: "image/png", bytes: DEMO_IMAGE.length * 0.75 }] });
  out.push({
    id: id++,
    kind: "assistant",
    text: [
      "The billing page renders the same as before. **Summary** of the move:",
      "",
      "| Module | Files | Lines | Status |",
      "|:-------|------:|------:|:------:|",
      "| `billing/invoices` | 14 | +412 −388 | ✅ moved |",
      "| `billing/tax` | 9 | +201 −197 | ✅ moved |",
      "| `billing/legacy_export` | 3 | +0 −120 | ~~kept~~ removed |",
      "",
      "Next steps:",
      "1. Run the full suite on CI",
      "2. Ask _finance_ to check the [invoice preview](https://example.com/preview)",
      "   - especially VAT rounding",
      "- [x] Types compile",
      "- [ ] Remove the old `billing.ts` shim",
      "",
      "> The old import paths still work through the shim, so nothing breaks today.",
    ].join("\n"),
  });
  return out;
})();

function page(entries: ConversationEntry[], params: Record<string, unknown>): ConversationEntry[] {
  const limit = typeof params.limit === "number" ? params.limit : 150;
  if (typeof params.after === "number") return entries.filter((e) => e.id > (params.after as number)).slice(0, limit);
  if (typeof params.before === "number") return entries.filter((e) => e.id < (params.before as number)).slice(-limit);
  return entries.slice(-limit);
}

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
const DEMO_PLUGINS: PluginsResult["plugins"] = [
  {
    id: "fence",
    name: "fence",
    version: "0.1.0",
    description: "Pens for your agents: a space fenced off from your secrets and the network",
    actions: [
      { id: "new", title: "fence: new pen here", description: null, contexts: ["workspace"] },
      { id: "open", title: "fence: this space's pen", description: null, contexts: ["workspace"] },
    ],
    panes: [{ id: "window", title: "fence", description: null }],
    cards: [{ id: "pen", title: "Pen", context: "pane" }, { id: "pens", title: "Pens", context: "global" }],
  },
  {
    id: "graphdiff",
    name: "graphdiff",
    version: "0.1.0",
    description: "Review what your agent changed: a live tree of the diff in your browser",
    actions: [{ id: "open", title: "graphdiff: review changes", description: null, contexts: ["workspace"] }, { id: "tui", title: "graphdiff: map in the terminal", description: null, contexts: ["workspace"] }],
    panes: [{ id: "tui", title: "graphdiff", description: null }],
    cards: [],
  },
];

function demoCards(paneId: string | null): CardsResult["cards"] {
  const at = Date.now() - 20_000;
  const pens: CardsResult["cards"][number] = {
    plugin: "fence",
    pluginName: "fence",
    id: "pens",
    title: "Pens",
    context: "global",
    updatedAt: at,
    body: { rows: [{ kind: "list", items: [{ text: "api", detail: "strict · 2 agents inside" }, { text: "web", detail: "default" }] }], buttons: [] },
  };
  if (!paneId) return [pens];
  const penned = paneId.startsWith("w1:");
  return [
    {
      plugin: "fence",
      pluginName: "fence",
      id: "pen",
      title: "Pen",
      context: "pane",
      updatedAt: at,
      body: penned
        ? {
            rows: [
              { kind: "badge", text: "penned", tone: "ok" },
              { kind: "text", label: "Profile", value: "strict: no ~/.ssh, no ~/.aws, no network except the package registry" },
            ],
            buttons: [{ label: "Open fence", pane: "window" }],
          }
        : { rows: [{ kind: "badge", text: "not penned", tone: "warn" }, { kind: "text", value: "This agent can read everything you can." }], buttons: [{ label: "Make this a pen", action: "new", confirm: "Agents here lose access to your secrets and the network. Running agents keep theirs until restarted." }] },
    },
    pens,
    {
      plugin: "fence",
      pluginName: "fence",
      id: "actions",
      title: "Actions",
      context: "pane",
      updatedAt: 0,
      body: { rows: [], buttons: [{ label: "fence: new pen here", action: "new" }, { label: "fence: this space's pen", action: "open" }] },
    },
    {
      plugin: "graphdiff",
      pluginName: "graphdiff",
      id: "actions",
      title: "Actions",
      context: "pane",
      updatedAt: 0,
      body: { rows: [], buttons: [{ label: "graphdiff: review changes", action: "open" }, { label: "graphdiff: map in the terminal", action: "tui" }] },
    },
  ];
}

export class DemoHost implements HostConnection {
  private readonly computer: "studio" | "laptop";
  private state: HostState;

  /** "laptop" is the demo's second computer, with a couple of agents. */
  constructor(computer: "studio" | "laptop" = "studio") {
    this.computer = computer;
    const settings = computer === "laptop" ? DEMO_LAPTOP_SETTINGS : DEMO_SETTINGS;
    this.state = {
      status: "online",
      error: null,
      host: { name: settings.name!, herdrVersion: "0.9.1" },
      activeUrl: settings.urls.at(-1)!,
      urls: settings.urls,
      device: { id: "a1b2c3", name: "Pixel 9" },
      agents: computer === "laptop" ? LAPTOP_AGENTS : AGENTS,
    };
  }

  private model = {
    model: "Opus 5.5" as string | null,
    effort: "high" as string | null,
    models: [
      { label: "Default", detail: "Opus 5.5 · Best for everyday, complex tasks" },
      { label: "Opus 5.5", detail: "For complex work and everyday tasks" },
      { label: "Fable 5.1", detail: "For your toughest challenges" },
      { label: "Sonnet 5.5", detail: "Most efficient for simpler tasks" },
      { label: "Haiku 4.5", detail: "Fastest for quick answers" },
    ],
    efforts: ["low", "medium", "high", "xhigh", "max"].map((label) => ({ label })),
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
        return { read: { text: params.target === "w1:p1" ? (this.computer === "laptop" ? LAPTOP_BLOCKED_SCREEN : BLOCKED_SCREEN) : "Done.\n" } } as T;
      case "agent.list":
        return { agents: this.state.agents } as T;
      case "session.snapshot":
        return { snapshot: this.computer === "laptop" ? LAPTOP_SNAPSHOT : SNAPSHOT } as T;
      case "pane.read":
        return { read: { text: history(String(params.pane_id)) } } as T;
      case "pane.send_keys":
      case "pane.send_input":
        return { type: "ok" } as T;
      case "shepherd.images": {
        if (params.paneId !== "w1:p3") return { available: true, session: "demo", groups: [] } satisfies ImagesResult as T;
        const ref = { id: "1:0", mime: "image/png", bytes: DEMO_IMAGE.length * 0.75 };
        return {
          available: true,
          session: "demo-long",
          groups: [
            { message: "Step 8: move the next part of billing into its own module.", images: [ref, { ...ref, id: "2:0" }, { ...ref, id: "3:0" }, { ...ref, id: "4:0" }] },
            { message: "Step 3: move the tax code.", images: [{ ...ref, id: "5:0" }] },
          ],
        } satisfies ImagesResult as T;
      }
      case "shepherd.image": {
        const from = typeof params.from === "number" ? params.from : 0;
        return { available: true, mime: "image/png", total: DEMO_IMAGE.length, from, data: DEMO_IMAGE.slice(from, from + 4096) } satisfies ImageResult as T;
      }
      case "shepherd.model":
      case "shepherd.set_model": {
        if (typeof params.model === "string") this.model.model = params.model;
        if (typeof params.effort === "string") this.model.effort = params.effort;
        if (method === "shepherd.set_model") await new Promise((r) => setTimeout(r, 900));
        return { available: true, agent: "claude", ...this.model } satisfies ModelResult as T;
      }
      case "shepherd.commands":
        return {
          available: true,
          commands: [
            { name: "/clear", description: "Start a new session with empty context" },
            { name: "/compact", description: "Free up context by summarizing the conversation so far" },
            { name: "/context", description: "Visualize current context usage", opens: "terminal" },
            { name: "/model", description: "Set the AI model", opens: "model" },
            { name: "/effort", description: "Set effort level for model usage", hint: "low | medium | high | xhigh | max" },
            { name: "/review-pr", description: "Review a pull request against our checklist", hint: "PR number" },
            { name: "/diff", description: "View uncommitted changes and per-turn diffs", opens: "terminal" },
            { name: "/plan", description: "Enable plan mode or view the current session plan" },
            { name: "/recap", description: "Generate a one-line session recap now" },
            { name: "/resume", description: "Resume a previous conversation", opens: "terminal" },
            { name: "/rewind", description: "Restore the code and/or conversation to a previous point", opens: "terminal" },
            { name: "/status", description: "Show version, model, account and connectivity", opens: "terminal" },
            { name: "/usage", description: "Show session cost, plan usage, and activity stats", opens: "terminal" },
          ],
        } as T;
      case "shepherd.make_folder":
        return { name: String(params.name).trim(), path: `${String(params.path)}/${String(params.name).trim()}`, repo: false } as T;
      case "shepherd.folders": {
        const home = "/Users/demo";
        const path = typeof params.path === "string" ? params.path.replace(/^~/, home) : home;
        const f = (name: string, repo = false) => ({ name, path: `${path}/${name}`, repo });
        const listing: Record<string, ReturnType<typeof f>[]> = {
          [home]: [f("Desktop"), f("Documents"), f("code"), f("notes")],
          [`${home}/code`]: [f("api", true), f("cli", true), f("docs", true), f("web", true)],
        };
        return {
          path,
          parent: path === home ? null : path.split("/").slice(0, -1).join("/"),
          folders: listing[path] ?? [],
          ...(params.path
            ? {}
            : {
                suggestions: {
                  recent: [{ name: "api", path: `${home}/code/api`, repo: true }, { name: "web", path: `${home}/code/web`, repo: true }],
                  repos: [{ name: "cli", path: `${home}/code/cli`, repo: true }, { name: "docs", path: `${home}/code/docs`, repo: true }],
                },
              }),
        } satisfies FoldersResult as T;
      }
      case "shepherd.subagents":
        return (params.paneId === "w1:p3" ? { available: true, subagents: DEMO_SUBAGENTS } : { available: true, subagents: [] }) satisfies SubagentsResult as T;
      case "shepherd.conversation": {
        if (params.paneId === "w1:p3" && params.subagent) {
          return {
            available: true,
            agent: "claude",
            session: `demo-long/${String(params.subagent)}`,
            entries: page(SUBAGENT_CONVERSATION, params),
            first: 0,
            last: SUBAGENT_CONVERSATION.length - 1,
            subagents: DEMO_SUBAGENTS,
          } satisfies ConversationResult as T;
        }
        if (params.paneId === "w1:p3") {
          return {
            subagents: DEMO_SUBAGENTS,
            available: true,
            agent: "claude",
            session: "demo-long",
            entries: page(LONG_CONVERSATION, params),
            first: 0,
            last: LONG_CONVERSATION.length - 1,
          } satisfies ConversationResult as T;
        }
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
        return { available: true, diff: params.path === SESSION_EDIT.path ? SESSION_EDIT : { ...LOGIN_EDIT, path: String(params.path) } } satisfies FileDiffResult as T;
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
      case "shepherd.plugins":
        return { plugins: DEMO_PLUGINS } satisfies PluginsResult as T;
      case "shepherd.cards":
        return { cards: demoCards(typeof params.paneId === "string" ? params.paneId : null) } satisfies CardsResult as T;
      case "shepherd.plugin_action":
        await new Promise((r) => setTimeout(r, 700));
        return { status: "succeeded", output: params.action === "new" ? "Fenced w1 as a pen: no secrets, no network." : null, error: null } satisfies PluginActionResult as T;
      case "shepherd.plugin_pane":
        return { paneId: "w1:p2", workspaceId: "w1" } satisfies PluginPaneResult as T;
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
