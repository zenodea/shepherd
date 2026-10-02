import { describe, expect, it } from "vitest";
import { truncate, visibleLength } from "./ansi.ts";
import { phoneRows, render, type ViewState, type WindowData } from "./window.ts";

const now = Date.parse("2026-10-02T12:00:00Z");
const plain = (lines: string[]) => lines.map((l) => l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")).join("\n");

const data = (patch: Partial<WindowData> = {}): WindowData => ({
  name: "studio-mac",
  running: { pid: 42, socketPath: "/tmp/herdr.sock", startedAt: "2026-10-02T09:46:00Z" },
  status: {
    pid: 42,
    startedAt: "2026-10-02T09:46:00Z",
    herdr: { version: "0.9.1", socketPath: "/tmp/herdr.sock" },
    port: 7420,
    addresses: [{ label: "LAN", url: "ws://192.168.1.20:7420/connect" }],
    agents: { total: 3, blocked: 1, working: 1 },
    phones: [{ deviceId: "new", via: "relay", since: "2026-10-02T11:30:00Z" }],
    relay: { state: "online" },
    updatedAt: "2026-10-02T12:00:00Z",
  },
  service: { installed: false, detail: "not loaded" },
  turnedOff: false,
  devices: [
    { id: "old", name: "Old phone", tokenHash: "", createdAt: "2026-09-01T00:00:00Z", lastSeenAt: "2026-09-29T18:00:00Z" },
    { id: "new", name: "Pixel 8", tokenHash: "", createdAt: "2026-10-01T00:00:00Z" },
  ],
  addresses: [{ label: "LAN", url: "ws://192.168.1.20:7420/connect" }],
  relayConfigured: true,
  log: ["[agent] w1:p1 working → idle"],
  logFile: "/tmp/host.log",
  ...patch,
});

const view = (patch: Partial<ViewState> = {}): ViewState => ({
  screen: "overview",
  selected: 0,
  confirmRevoke: null,
  flash: null,
  pairing: null,
  now,
  ...patch,
});

describe("Shepherd window", () => {
  it("summarises a running host", () => {
    const out = plain(render(view(), data(), 100, 40));
    expect(out).toMatch(/Shepherd +━━━● on +\[s\] +running for 2h 14m · pid 42/);
    expect(out).toContain("3 · 1 needs you · 1 working");
    expect(out).toContain("1 connected · 2 paired");
    expect(out).toContain("online");
  });

  it("offers to turn a stopped host on, and says when it was turned off", () => {
    const out = plain(render(view(), data({ running: null, status: null }), 120, 40));
    expect(out).toMatch(/Shepherd +●━━━ off +\[s\] +not running/);
    expect(out).not.toContain("connected ·");
    expect(plain(render(view(), data({ running: null, status: null, turnedOff: true }), 120, 40))).toMatch(
      /Shepherd +●━━━ off +\[s\] +phones can't connect, and herdr won't start it/,
    );
  });

  it("has no switch when the background service runs the host", () => {
    const out = plain(render(view(), data({ service: { installed: true, detail: "running" } }), 120, 40));
    expect(out).toMatch(/Shepherd +━━━● on +running/);
    expect(out).not.toContain("[s]  ");
    expect(out).toContain("Run by the background service (running)");
  });

  it("lists connected phones first, with how they connect", () => {
    expect(phoneRows(data()).map((r) => r.device.id)).toEqual(["new", "old"]);
    const out = plain(render(view({ screen: "phones" }), data(), 100, 40));
    expect(out).toMatch(/› ● Pixel 8 +connected · through the relay/);
    expect(out).toMatch(/○ Old phone +last seen/);
  });

  it("asks before revoking", () => {
    const out = plain(render(view({ screen: "phones", confirmRevoke: "old" }), data(), 100, 40));
    expect(out).toContain("Revoke Old phone? It's disconnected at once and has to pair again.  y yes · n no");
  });

  it("shows the QR code with its countdown, and asks for room when it doesn't fit", () => {
    const pairing = { qr: ["█▀▀█", "█▄▄█"], code: "p_abc", expiresAt: now + 90_000 };
    const out = plain(render(view({ screen: "pair", pairing }), data(), 100, 40));
    expect(out).toContain("valid for 1:30");
    expect(out).toContain("  █▀▀█");
    expect(out).toContain("Or enter it by hand: p_abc");
    expect(plain(render(view({ screen: "pair", pairing }), data(), 4, 40))).toContain("Make this window bigger");
    expect(plain(render(view({ screen: "pair", pairing: { ...pairing, expiresAt: now - 1 } }), data(), 100, 40))).toContain("This code has expired.");
  });

  it("always fills the window exactly", () => {
    for (const screen of ["overview", "pair", "phones", "log"] as const) {
      expect(render(view({ screen }), data(), 80, 30)).toHaveLength(30);
    }
  });
});

describe("truncate", () => {
  it("cuts by visible characters and keeps styles balanced", () => {
    const cut = truncate("\x1b[32mhello\x1b[39m world", 7);
    expect(visibleLength(cut)).toBe(7);
    expect(cut.endsWith("\x1b[0m")).toBe(true);
  });
});

describe("the window process", () => {
  it("starts and keeps running until it's closed", async () => {
    const { spawn } = await import("node:child_process");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "shepherd-ui-"));
    const child = spawn(process.execPath, [new URL("../cli.ts", import.meta.url).pathname, "ui"], {
      env: { ...process.env, SHEPHERD_CONFIG: join(dir, "host.json"), SHEPHERD_PORT: "7499" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    const early = await Promise.race([exited, new Promise((r) => setTimeout(() => r("running"), 1500))]);
    child.stdin.write("q");
    expect(early, output).toBe("running");
    expect(output).toContain("Shepherd");
    expect(await exited).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
