// Run the host in the background: a launchd agent on macOS, a systemd user
// unit on Linux. Both start it at login and restart it if it exits.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LAUNCHD_LABEL = "dev.shepherd.host";
export const SYSTEMD_UNIT = "shepherd-host.service";

/** Variables worth carrying into the service; herdr's per-pane ones are left out. */
const PASSED_ENV = ["PATH", "SHEPHERD_PORT", "SHEPHERD_BIND", "SHEPHERD_CONFIG", "HERDR_BIN", "HERDR_SESSION", "XDG_CONFIG_HOME", "LANG"];

export type ServiceSpec = {
  node: string;
  script: string;
  workingDirectory: string;
  env: Record<string, string>;
  logFile: string;
};

export function serviceSpec(env: NodeJS.ProcessEnv = process.env, home = homedir()): ServiceSpec {
  const script = fileURLToPath(new URL("../cli.ts", import.meta.url));
  const picked: Record<string, string> = {};
  for (const key of PASSED_ENV) if (env[key]) picked[key] = env[key]!;
  return {
    node: process.execPath,
    script,
    // Repo root: apps/host/src/cli.ts → ../../..
    workingDirectory: resolve(dirname(script), "..", "..", ".."),
    env: picked,
    logFile: process.platform === "darwin" ? join(home, "Library", "Logs", "shepherd-host.log") : join(home, ".local", "state", "shepherd", "host.log"),
  };
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function launchdPlist(spec: ServiceSpec, label = LAUNCHD_LABEL): string {
  const env = Object.entries(spec.env)
    .map(([k, v]) => `      <key>${xml(k)}</key>\n      <string>${xml(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${xml(label)}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${xml(spec.node)}</string>
      <string>${xml(spec.script)}</string>
      <string>serve</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${xml(spec.workingDirectory)}</string>
    <key>EnvironmentVariables</key>
    <dict>
${env}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${xml(spec.logFile)}</string>
    <key>StandardErrorPath</key>
    <string>${xml(spec.logFile)}</string>
  </dict>
</plist>
`;
}

function systemdQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function systemdUnit(spec: ServiceSpec): string {
  const env = Object.entries(spec.env)
    .map(([k, v]) => `Environment=${systemdQuote(`${k}=${v}`)}`)
    .join("\n");
  return `[Unit]
Description=shepherd host: bridge herdr agents to your phone
After=network-online.target

[Service]
ExecStart=${systemdQuote(spec.node)} ${systemdQuote(spec.script)} serve
WorkingDirectory=${systemdQuote(spec.workingDirectory)}
${env}
Restart=always
RestartSec=5
StandardOutput=append:${spec.logFile}
StandardError=append:${spec.logFile}

[Install]
WantedBy=default.target
`;
}

type Run = (cmd: string, args: string[]) => string;
const run: Run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function launchdPaths(home: string, label: string) {
  return { plist: join(home, "Library", "LaunchAgents", `${label}.plist`), domain: `gui/${process.getuid?.() ?? 501}` };
}

function systemdPath(home: string) {
  return join(home, ".config", "systemd", "user", SYSTEMD_UNIT);
}

export type ServiceStatus = { installed: boolean; running: boolean; detail: string; logFile: string };

export class Service {
  private readonly home: string;
  private readonly label: string;
  private readonly exec: Run;

  constructor(opts: { home?: string; label?: string; run?: Run } = {}) {
    this.home = opts.home ?? homedir();
    this.label = opts.label ?? LAUNCHD_LABEL;
    this.exec = opts.run ?? run;
  }

  install(spec: ServiceSpec = serviceSpec(process.env, this.home)): string {
    mkdirSync(dirname(spec.logFile), { recursive: true });
    if (process.platform === "darwin") {
      const { plist, domain } = launchdPaths(this.home, this.label);
      mkdirSync(dirname(plist), { recursive: true });
      // Replace any previous version so changes to PATH etc. take effect.
      this.tryExec("launchctl", ["bootout", `${domain}/${this.label}`]);
      writeFileSync(plist, launchdPlist(spec, this.label));
      this.exec("launchctl", ["bootstrap", domain, plist]);
      return plist;
    }
    if (process.platform === "linux") {
      const unit = systemdPath(this.home);
      mkdirSync(dirname(unit), { recursive: true });
      writeFileSync(unit, systemdUnit(spec));
      this.exec("systemctl", ["--user", "daemon-reload"]);
      this.exec("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT]);
      this.tryExec("systemctl", ["--user", "restart", SYSTEMD_UNIT]);
      return unit;
    }
    throw new Error(`Background service isn't supported on ${process.platform}; run the host in a terminal instead.`);
  }

  uninstall(): boolean {
    if (process.platform === "darwin") {
      const { plist, domain } = launchdPaths(this.home, this.label);
      this.tryExec("launchctl", ["bootout", `${domain}/${this.label}`]);
      const existed = existsSync(plist);
      rmSync(plist, { force: true });
      return existed;
    }
    if (process.platform === "linux") {
      const unit = systemdPath(this.home);
      this.tryExec("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT]);
      const existed = existsSync(unit);
      rmSync(unit, { force: true });
      this.tryExec("systemctl", ["--user", "daemon-reload"]);
      return existed;
    }
    return false;
  }

  status(): ServiceStatus {
    const logFile = serviceSpec(process.env, this.home).logFile;
    if (process.platform === "darwin") {
      const { plist, domain } = launchdPaths(this.home, this.label);
      const out = this.tryExec("launchctl", ["print", `${domain}/${this.label}`]);
      const state = /^\s*state = (.+)$/m.exec(out ?? "")?.[1]?.trim();
      const pid = /^\s*pid = (\d+)$/m.exec(out ?? "")?.[1];
      return {
        installed: existsSync(plist),
        running: state === "running",
        detail: out ? `${state ?? "unknown"}${pid ? ` (pid ${pid})` : ""}` : "not loaded",
        logFile,
      };
    }
    if (process.platform === "linux") {
      const out = this.tryExec("systemctl", ["--user", "is-active", SYSTEMD_UNIT])?.trim() ?? "inactive";
      return { installed: existsSync(systemdPath(this.home)), running: out === "active", detail: out, logFile };
    }
    return { installed: false, running: false, detail: "unsupported platform", logFile };
  }

  private tryExec(cmd: string, args: string[]): string | null {
    try {
      return this.exec(cmd, args);
    } catch {
      return null;
    }
  }
}
