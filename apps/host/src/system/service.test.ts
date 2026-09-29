import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LAUNCHD_LABEL, Service, launchdPlist, serviceSpec, systemdUnit } from "./service.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempHome = () => {
  const d = mkdtempSync(join(tmpdir(), "sheperd-service-"));
  dirs.push(d);
  return d;
};

describe("serviceSpec", () => {
  it("runs this checkout's cli with this node, keeping PATH but not herdr's per-pane variables", () => {
    const spec = serviceSpec(
      { PATH: "/opt/homebrew/bin:/usr/bin", SHEPERD_PORT: "7421", HERDR_PANE_ID: "w1:p1", HERDR_SOCKET_PATH: "/x.sock", SECRET: "no" },
      "/Users/me",
    );
    expect(spec.node).toBe(process.execPath);
    expect(spec.script).toMatch(/host[/\\]src[/\\]cli\.ts$/);
    expect(spec.env).toEqual({ PATH: "/opt/homebrew/bin:/usr/bin", SHEPERD_PORT: "7421" });
  });
});

const spec = {
  node: "/usr/local/bin/node",
  script: "/code/sheperd & co/host/src/cli.ts",
  workingDirectory: "/code/sheperd & co",
  env: { PATH: "/usr/bin:/bin" },
  logFile: "/Users/me/Library/Logs/sheperd-host.log",
};

describe("launchdPlist", () => {
  it("escapes XML and keeps the service alive", () => {
    const plist = launchdPlist(spec);
    expect(plist).toContain("<string>/code/sheperd &amp; co/host/src/cli.ts</string>");
    expect(plist).toContain("<key>KeepAlive</key>\n    <true/>");
    expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
  });

  it.skipIf(process.platform !== "darwin")("is a valid property list", () => {
    const file = join(tempHome(), "test.plist");
    writeFileSync(file, launchdPlist(spec));
    expect(execFileSync("plutil", ["-lint", file], { encoding: "utf8" })).toContain("OK");
  });
});

describe("systemdUnit", () => {
  it("quotes paths and restarts on exit", () => {
    const unit = systemdUnit(spec);
    expect(unit).toContain('ExecStart="/usr/local/bin/node" "/code/sheperd & co/host/src/cli.ts" serve');
    expect(unit).toContain('Environment="PATH=/usr/bin:/bin"');
    expect(unit).toContain("Restart=always");
  });
});

describe.skipIf(process.platform !== "darwin")("Service on macOS", () => {
  it("installs, reports status and uninstalls through launchctl", () => {
    const home = tempHome();
    const calls: string[][] = [];
    let loaded = false;
    const service = new Service({
      home,
      run: (cmd, args) => {
        calls.push([cmd, ...args]);
        if (args[0] === "bootstrap") loaded = true;
        if (args[0] === "bootout") {
          if (!loaded) throw new Error("not loaded");
          loaded = false;
        }
        if (args[0] === "print") {
          if (!loaded) throw new Error("not loaded");
          return "\tstate = running\n\tpid = 4242\n";
        }
        return "";
      },
    });

    const plist = service.install({ ...spec, logFile: join(home, "logs", "host.log") });
    expect(plist).toBe(join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`));
    expect(readFileSync(plist, "utf8")).toContain("<key>RunAtLoad</key>");
    expect(calls.find((c) => c[1] === "bootstrap")).toEqual(["launchctl", "bootstrap", `gui/${process.getuid!()}`, plist]);
    expect(service.status()).toMatchObject({ installed: true, running: true, detail: "running (pid 4242)" });

    expect(service.uninstall()).toBe(true);
    expect(existsSync(plist)).toBe(false);
    expect(service.status()).toMatchObject({ installed: false, running: false, detail: "not loaded" });
    expect(service.uninstall()).toBe(false);
  });
});
