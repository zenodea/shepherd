import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { extractPrompt, toHex, type PaneReadResult, type TerminalMode } from "@shepherd/protocol";
import { AgentTracker } from "./herdr/agent-tracker.ts";
import { generateSecret, hostCommand, hostKeyPair, loadConfig, loadOrCreateStoredConfig, saveStoredConfig, type HostConfig } from "./system/config.ts";
import { DeviceRegistry } from "./pairing/devices.ts";
import { HerdrClient } from "./herdr/herdr-client.ts";
import { ActivityLog } from "./herdr/activity-log.ts";
import { Launcher } from "./herdr/launcher.ts";
import { NotificationActions } from "./notifications/actions.ts";
import { Notifier, ntfyBase, ntfySubscribeUrl } from "./notifications/notifier.ts";
import { hostAddresses, printDevices, printHostInfo, printPairing, renderQr } from "./pairing/pairing.ts";
import { RelayTunnel, appRelayUrl } from "./connection/relay-tunnel.ts";
import { startLocalServer } from "./connection/server.ts";
import type { SessionDeps } from "./connection/session.ts";
import { Service, serviceSpec } from "./system/service.ts";
import { clearPidFile, readRunningHost, startDetached, stopRunningHost, writePidFile } from "./system/daemon.ts";
import { TerminalStream } from "./herdr/terminal-stream.ts";

const USAGE = `shepherd-host — bridge your herdr agents to the shepherd app

Usage (from the repo root):
  npm run host                             Run the host; prints a pairing QR code
  npm run host -- pair                     Print a new one-time pairing QR code
  npm run host -- info                     Show addresses and paired devices
  npm run host -- devices                  List paired devices
  npm run host -- devices revoke <id|all>  Unpair a device (disconnects it immediately)
  npm run host -- relay <url> <host-token> Also connect through a shepherd relay
  npm run host -- relay off                Stop using the relay
  npm run host -- notify on [ntfy-server]  Push notifications via ntfy (default https://ntfy.sh)
  npm run host -- notify test              Send a test notification
  npm run host -- notify off               Stop notifications
  npm run host -- service install          Run in the background (launchd / systemd)
  npm run host -- service uninstall|status|logs
  npm run host -- status                   Is the host running, addresses, devices, recent log

As a herdr plugin (herdr-plugin.toml) the host runs in the background while herdr does:
  npm run host -- ensure                   Start it in the background unless it's already running
  npm run host -- restart | stop           Restart or stop it
  npm run host -- pair --wait              Wait for a key (or a phone to pair) before exiting

Environment:
  SHEPHERD_PORT    Port for direct connections (default 7420)
  SHEPHERD_BIND    Address to listen on (default 0.0.0.0)
  SHEPHERD_CONFIG  Config file (default ~/.config/shepherd/host.json)
  HERDR_BIN       herdr binary (default "herdr" on PATH)
  HERDR_SESSION / HERDR_SOCKET_PATH  Target a named herdr session or socket
`;

const HERDR_WAIT_MS = 5000;
/** With --follow-herdr, exit once herdr has been unreachable this long. */
const HERDR_GONE_MS = 60_000;

/** Wait for herdr to come up (e.g. the host started at login before herdr). */
async function waitForHerdr(herdr: HerdrClient, socketPath: string): Promise<string> {
  let warned = false;
  for (;;) {
    try {
      return (await herdr.request<{ version: string }>("ping")).version;
    } catch (err) {
      if (!warned) {
        console.error(`Waiting for herdr at ${socketPath} (${(err as Error).message}).`);
        console.error("Start herdr (run `herdr`), or set HERDR_SESSION / HERDR_SOCKET_PATH.");
        warned = true;
      }
      await new Promise((r) => setTimeout(r, HERDR_WAIT_MS));
    }
  }
}

async function serve(config: HostConfig, { followHerdr = false } = {}): Promise<void> {
  const running = readRunningHost(config.configPath);
  if (running) {
    console.error(`A host is already running (pid ${running.pid}), perhaps started by the herdr plugin. Stop it with: ${hostCommand("stop")}`);
    process.exit(1);
  }
  const herdr = new HerdrClient(config.socketPath);
  const herdrVersion = await waitForHerdr(herdr, config.socketPath);

  const tracker = new AgentTracker(herdr);
  tracker.on("error", (err) => console.error(`[herdr] ${err.message}`));
  tracker.on("status", (c) => console.log(`[agent] ${c.paneId} ${c.previous ?? "?"} → ${c.status}`));
  await tracker.start();

  const devices = new DeviceRegistry(config.configPath);
  devices.watch();

  const activity = new ActivityLog({ path: join(dirname(config.configPath), "activity.json") });
  activity.attach(tracker);

  const deps: SessionDeps = {
    herdr,
    tracker,
    devices,
    hostKey: hostKeyPair(config),
    host: { name: config.name, herdrVersion, notifyUrl: config.notify ? ntfySubscribeUrl(config.notify) : undefined },
    openTerminal: (paneId: string, mode: TerminalMode, cols: number, rows: number) =>
      new TerminalStream({ herdrBin: config.herdrBin, socketPath: config.socketPath, paneId, mode, cols, rows }),
    launcher: new Launcher({ herdr, onError: (err) => console.error(`[launch] ${err.message}`) }),
    activity,
  };

  const server = await startLocalServer({ port: config.port, bind: config.bind, deps }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${config.port} is already in use. Is another shepherd host running (a terminal, or \`service status\`)?`);
      process.exit(1);
    }
    throw err;
  });
  deps.host.addresses = hostAddresses(config, server.port).map((a) => a.url);
  writePidFile(config.configPath, config.socketPath);
  console.log(`shepherd-host connected to herdr ${herdrVersion}, tracking ${tracker.list().length} agent(s).`);
  // A QR code is only useful to a person at a terminal, not in a service log.
  if (process.stdout.isTTY) await printPairing(config, devices, server.port);
  else console.log(`Pair a phone with: ${hostCommand("pair")}`);
  printDevices(devices);
  console.log("");

  let actions: NotificationActions | null = null;
  if (config.notify) {
    const onError = (err: Error) => console.error(`[notify] ${err.message}`);
    const readPrompt = async (paneId: string) => {
      const { read } = await herdr.request<{ read: PaneReadResult }>("agent.read", { target: paneId, source: "visible", format: "text" });
      return extractPrompt(read.text);
    };
    if (config.notify.actions !== false) {
      actions = new NotificationActions({
        server: config.notify.server,
        topic: config.notify.topic,
        secret: deps.hostKey.secretKey,
        readPrompt,
        isBlocked: (paneId) => tracker.get(paneId)?.agent_status === "blocked",
        sendKey: async (paneId, key) => void (await herdr.request("agent.send_keys", { target: paneId, keys: [key] })),
        onOutcome: (outcome) => {
          if (outcome.ok) console.log(`[notify] answered ${outcome.paneId}: ${outcome.label}`);
          else if (outcome.reason !== "invalid") void notifier.actionFailed(outcome, outcome.paneId ? tracker.get(outcome.paneId) : null);
        },
        onError,
      });
      actions.start();
    }
    const notifier = new Notifier({
      config: config.notify,
      hostName: config.name,
      hostId: toHex(deps.hostKey.publicKey).slice(0, 16),
      prompts: actions ? { read: readPrompt, actions } : undefined,
      onError,
    });
    notifier.attach(tracker);
    console.log(`Notifications on: ${ntfyBase(config.notify.server)}/${config.notify.topic}${actions ? " (with answer buttons)" : ""}`);
  }

  let tunnel: RelayTunnel | null = null;
  if (config.relayUrl && config.relayHostToken) {
    tunnel = new RelayTunnel({
      relayUrl: config.relayUrl,
      hostId: config.hostId,
      hostToken: config.relayHostToken,
      deps,
    });
    tunnel.on("state", (state, detail) => console.log(`[relay] ${state}${detail ? `: ${detail}` : ""}`));
    tunnel.start();
  }

  // Started by the herdr plugin: live as long as herdr does. A brief gap (a
  // live handoff to a new herdr server) is fine; the tracker reconnects.
  let herdrWatch: NodeJS.Timeout | undefined;
  if (followHerdr) {
    let lastSeen = Date.now();
    herdrWatch = setInterval(() => {
      herdr.request("ping", {}, { timeoutMs: 5000 }).then(
        () => (lastSeen = Date.now()),
        () => {
          if (Date.now() - lastSeen < HERDR_GONE_MS) return;
          console.log(`herdr has been unreachable for ${HERDR_GONE_MS / 1000}s; stopping.`);
          void shutdown();
        },
      );
    }, 10_000);
  }

  const shutdown = async () => {
    clearInterval(herdrWatch);
    clearPidFile(config.configPath);
    tunnel?.stop();
    actions?.stop();
    devices.unwatch();
    tracker.stop();
    activity.flush();
    await server.close();
    herdr.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function notifyCommand(args: string[]): Promise<void> {
  const config = loadConfig();
  const stored = loadOrCreateStoredConfig(config.configPath);
  const [action, server = "https://ntfy.sh"] = args;

  if (action === "on") {
    try {
      new URL(server);
    } catch {
      console.error(`Invalid ntfy server URL: ${server}`);
      process.exit(2);
    }
    const notify = stored.notify?.server === server ? stored.notify : { server, topic: `shepherd-${generateSecret(15)}` };
    saveStoredConfig(config.configPath, { ...stored, notify });
    const subscribe = ntfySubscribeUrl(notify);
    console.log("\n  Notifications enabled. On your phone:");
    console.log("   1. Install ntfy (https://ntfy.sh, Play Store or F-Droid)");
    console.log("   2. Scan this with your camera, or tap Host → Get notifications in Shepherd:\n");
    console.log((await renderQr(subscribe)).trimEnd().replace(/^/gm, "  ") + "\n");
    console.log(`  Topic: ${ntfyBase(notify.server)}/${notify.topic}`);
    console.log("  Treat the topic like a password: anyone who knows it can read your notifications.");
    console.log("  Restart the host to apply.\n");
    return;
  }
  if (action === "actions") {
    const mode = args[1];
    if (!stored.notify || (mode !== "on" && mode !== "off")) {
      console.error(stored.notify ? "Usage: notify actions on|off" : "Notifications are off. Run: npm run host -- notify on");
      process.exit(2);
    }
    saveStoredConfig(config.configPath, { ...stored, notify: { ...stored.notify, actions: mode === "on" } });
    console.log(`Answer buttons ${mode === "on" ? "on" : "off"}. Restart the host to apply.`);
    return;
  }
  if (action === "off") {
    const { notify: _notify, ...rest } = stored;
    saveStoredConfig(config.configPath, rest);
    console.log("Notifications disabled. Restart the host to apply.");
    return;
  }
  if (action === "test") {
    if (!stored.notify) {
      console.error("Notifications are off. Run: npm run host -- notify on");
      process.exit(1);
    }
    let failed: Error | null = null;
    await new Notifier({ config: stored.notify, hostName: config.name, onError: (e) => (failed = e) }).publish({
      topic: stored.notify.topic,
      title: "Shepherd test",
      message: `Notifications from ${config.name} are working.`,
      priority: 3,
      tags: ["tada"],
      click: "shepherd://",
    });
    if (failed) {
      console.error(`Failed: ${(failed as Error).message}`);
      process.exit(1);
    }
    console.log("Sent. Check your phone.");
    return;
  }
  console.error("Usage: notify on [ntfy-server] | notify off | notify test | notify actions on|off");
  process.exit(2);
}

async function serviceCommand(action: string | undefined): Promise<void> {
  const service = new Service();
  switch (action) {
    case "install": {
      const path = service.install();
      console.log(`Installed ${path}`);
      await new Promise((r) => setTimeout(r, 1500));
      const status = service.status();
      console.log(`Status: ${status.detail}. Logs: ${status.logFile}`);
      console.log("It starts at login and restarts if it stops. If a host is still running in a terminal, stop it (Ctrl-C).");
      console.log(`Pair a phone with: ${hostCommand("pair")}`);
      if (process.platform === "linux") {
        console.log("To keep it running when you're logged out: loginctl enable-linger $USER");
      }
      return;
    }
    case "uninstall":
      console.log(service.uninstall() ? "Background service removed." : "The background service wasn't installed.");
      return;
    case "status": {
      const status = service.status();
      console.log(status.installed ? `Installed, ${status.detail}.` : "Not installed. Install with: npm run host -- service install");
      console.log(`Logs: ${status.logFile}`);
      return;
    }
    case "logs": {
      const { logFile } = service.status();
      spawn("tail", ["-n", "50", "-F", logFile], { stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0));
      return;
    }
    default:
      console.error("Usage: service install | uninstall | status | logs");
      process.exit(2);
  }
}

/** The herdr plugin's startup hook: start the host in the background unless something already runs it. */
async function ensureCommand(): Promise<void> {
  const config = loadConfig();
  if (new Service().status().installed) {
    console.log("The background service runs the host; nothing to start.");
    return;
  }
  const running = readRunningHost(config.configPath);
  if (running) {
    console.log(`The host is already running (pid ${running.pid}, herdr at ${running.socketPath}).`);
    return;
  }
  const { logFile } = serviceSpec();
  console.log(`Started the host (pid ${startDetached(logFile)}). Logs: ${logFile}`);
}

async function restartCommand(): Promise<void> {
  const config = loadConfig();
  if (new Service().restart()) {
    console.log("Restarted the background service.");
    return;
  }
  const running = readRunningHost(config.configPath);
  await stopRunningHost(config.configPath);
  // Stay on the herdr session the stopped host was following.
  const env = running ? { ...process.env, HERDR_SOCKET_PATH: running.socketPath } : process.env;
  const { logFile } = serviceSpec();
  console.log(`${running ? "Restarted" : "Started"} the host (pid ${startDetached(logFile, env)}). Logs: ${logFile}`);
}

async function stopCommand(): Promise<void> {
  const config = loadConfig();
  if (new Service().status().installed) {
    console.error(`The background service runs the host. Remove it with: ${hostCommand("service uninstall")}`);
    process.exit(1);
  }
  console.log((await stopRunningHost(config.configPath)) ? "Stopped the host." : "The host isn't running.");
}

function statusCommand(): void {
  const config = loadConfig();
  const running = readRunningHost(config.configPath);
  const service = new Service().status();
  console.log("");
  if (running) {
    console.log(`  Running since ${new Date(running.startedAt).toLocaleString()} (pid ${running.pid})`);
    console.log(`  herdr:     ${running.socketPath}`);
  } else {
    console.log(`  Not running. Start it with: ${hostCommand(service.installed ? "service install" : "restart")}`);
  }
  if (service.installed) console.log(`  Service:   ${service.detail}`);
  printHostInfo(config, new DeviceRegistry(config.configPath));
  if (existsSync(service.logFile)) {
    const lines = readFileSync(service.logFile, "utf8").trimEnd().split("\n").slice(-12);
    console.log(`  Recent log (${service.logFile}):`);
    for (const line of lines) console.log(`    ${line}`);
    console.log("");
  }
}

/** For herdr plugin panes, which close when the command exits. */
function waitToClose(prompt = "Press any key to close."): Promise<void> {
  if (!process.stdin.isTTY) return Promise.resolve();
  console.log(`  ${prompt}`);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) =>
    process.stdin.once("data", () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve();
    }),
  );
}

async function pairCommand(wait: boolean): Promise<void> {
  const config = loadConfig();
  const devices = new DeviceRegistry(config.configPath);
  if (wait && !readRunningHost(config.configPath)) {
    console.log(`\n  The host isn't running, so a phone can't pair yet. Start it with: ${hostCommand("restart")}`);
  }
  await printPairing(config, devices);
  if (!wait) return;
  // Close by itself once the phone has paired.
  const before = new Set(devices.list().map((d) => d.id));
  const paired = new Promise<string>((resolve) => {
    devices.on("changed", () => {
      const added = devices.list().find((d) => !before.has(d.id));
      if (added) resolve(added.name);
    });
    devices.watch(500);
  });
  const name = await Promise.race([paired, waitToClose("Waiting for your phone. Press any key to close.").then(() => null)]);
  if (name) {
    console.log(`\n  Paired ${name}.`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  process.exit(0);
}

async function main(argv: string[]): Promise<void> {
  const [command = "serve"] = argv;
  switch (command) {
    case "serve":
      return serve(loadConfig(), { followHerdr: argv.includes("--follow-herdr") });
    case "ensure":
      return ensureCommand();
    case "restart":
      return restartCommand();
    case "stop":
      return stopCommand();
    case "status":
      statusCommand();
      return argv.includes("--wait") ? waitToClose() : undefined;
    case "info": {
      const config = loadConfig();
      return printHostInfo(config, new DeviceRegistry(config.configPath));
    }
    case "pair":
      return pairCommand(argv.includes("--wait"));
    case "devices": {
      const config = loadConfig();
      const devices = new DeviceRegistry(config.configPath);
      const [action, id] = argv.slice(1);
      if (!action) return printDevices(devices);
      if (action !== "revoke" || !id) {
        console.error("Usage: devices | devices revoke <id|all>");
        process.exit(2);
      }
      const removed = devices.revoke(id);
      if (removed === 0) {
        console.error(`No device with id ${id}.`);
        process.exit(1);
      }
      console.log(`Removed ${removed} device(s). A running host disconnects them within a second.`);
      return;
    }
    case "relay": {
      const config = loadConfig();
      const stored = loadOrCreateStoredConfig(config.configPath);
      const [url, hostToken] = argv.slice(1);
      if (url === "off") {
        const { relayUrl: _url, relayHostToken: _token, ...rest } = stored;
        saveStoredConfig(config.configPath, rest);
        console.log("Relay disabled. Restart the host to apply.");
        return;
      }
      if (!url || !hostToken) {
        console.error("Usage: relay <relay-url> <relay-host-token>   (or: relay off)");
        process.exit(2);
      }
      appRelayUrl(url, config.hostId); // validates the URL
      saveStoredConfig(config.configPath, { ...stored, relayUrl: url, relayHostToken: hostToken });
      console.log("Relay saved. Restart the host; paired phones learn the relay address the next time they connect.");
      return;
    }
    case "notify":
      return notifyCommand(argv.slice(1));
    case "service":
      return serviceCommand(argv[1]);
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return;
    default:
      console.error(`Unknown command: ${command}\n\n${USAGE}`);
      process.exit(2);
  }
}

await main(process.argv.slice(2));
