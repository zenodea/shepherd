import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { extractPrompt, toHex, type PaneReadResult, type TerminalMode } from "@shepherd/protocol";
import { AgentTracker } from "./herdr/agent-tracker.ts";
import {
  hostCommand,
  hostKeyPair,
  loadConfig,
  loadOrCreateStoredConfig,
  saveStoredConfig,
  type HostConfig,
} from "./system/config.ts";
import { DeviceRegistry } from "./pairing/devices.ts";
import { HerdrClient } from "./herdr/herdr-client.ts";
import { ActivityLog } from "./herdr/activity-log.ts";
import { Launcher } from "./herdr/launcher.ts";
import { hostAddresses, printDevices, printHostInfo, printPairing, renderQr } from "./pairing/pairing.ts";
import { RelayTunnel, appRelayUrl } from "./connection/relay-tunnel.ts";
import { ROUTE_LABELS, ROUTES, accepts, checkRoutes, listenAddress, routesOf, type Route, type Routes } from "./connection/routes.ts";
import { startLocalServer, type LocalServer } from "./connection/server.ts";
import type { SessionDeps } from "./connection/session.ts";
import { Service, serviceSpec } from "./system/service.ts";
import { HostStatusWriter } from "./system/host-status.ts";
import { Conversations } from "./conversation/conversations.ts";
import { Uploads } from "./uploads.ts";
import { SCREENS, runWindow, type Screen } from "./ui/window.ts";
import { clearPidFile, readRunningHost, restartHost, setConnections, startDetached, stopRunningHost, turnOff, turnOn, writePidFile } from "./system/daemon.ts";
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
  npm run host -- connections [lan] [tailscale] [relay]
                                           Which ways phones may connect (no arguments: show them)
  npm run host -- service install          Run in the background (launchd / systemd)
  npm run host -- service uninstall|status|logs
  npm run host -- status                   Is the host running, addresses, devices, recent log
  npm run host -- ui [pair|phones|log]     The Shepherd window: status, pairing, phones, log

As a herdr plugin (herdr-plugin.toml) the host runs in the background while herdr does:
  npm run host -- ensure                   Start it in the background unless it's already running
  npm run host -- restart | stop           Restart or stop it
  npm run host -- on | off                 Turn Shepherd on or off (off: herdr doesn't start it)

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
const TAILSCALE_WATCH_MS = 15_000;

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
    host: { name: config.name, herdrVersion },
    openTerminal: (paneId: string, mode: TerminalMode, cols: number, rows: number) =>
      new TerminalStream({ herdrBin: config.herdrBin, socketPath: config.socketPath, paneId, mode, cols, rows }),
    launcher: new Launcher({ herdr, onError: (err) => console.error(`[launch] ${err.message}`) }),
    activity,
    conversations: new Conversations(),
    uploads: new Uploads(),
  };

  const routes = routesOf(config);
  console.log(`Phones can connect over: ${ROUTES.filter((r) => routes[r]).map((r) => ROUTE_LABELS[r]).join(", ") || "nothing"}`);
  const direct = new DirectServer(config, routes, deps);
  await direct.start().catch((err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${config.port} is already in use. Is another shepherd host running (a terminal, or \`service status\`)?`);
      process.exit(1);
    }
    throw err;
  });
  const server = { port: direct.port };
  deps.host.addresses = hostAddresses(config, server.port).map((a) => a.url);
  writePidFile(config.configPath, config.socketPath);

  const agentCounts = () => {
    const list = tracker.list();
    return {
      total: list.length,
      blocked: list.filter((a) => a.agent_status === "blocked").length,
      working: list.filter((a) => a.agent_status === "working").length,
    };
  };
  const status = new HostStatusWriter(config.configPath, {
    herdr: { version: herdrVersion, socketPath: config.socketPath },
    port: server.port,
    addresses: hostAddresses(config, server.port),
    agents: agentCounts(),
    relay: null,
  });
  deps.presence = status;
  tracker.on("agents", () => status.update({ agents: agentCounts() }));
  tracker.on("status", () => status.update({ agents: agentCounts() }));
  console.log(`shepherd-host connected to herdr ${herdrVersion}, tracking ${tracker.list().length} agent(s).`);
  // A QR code is only useful to a person at a terminal, not in a service log.
  if (process.stdout.isTTY) await printPairing(config, devices, server.port);
  else console.log(`Pair a phone with: ${hostCommand("pair")}`);
  printDevices(devices);
  console.log("");

  let tunnel: RelayTunnel | null = null;
  if (config.relayUrl && config.relayHostToken && routes.relay) {
    tunnel = new RelayTunnel({
      relayUrl: config.relayUrl,
      hostId: config.hostId,
      hostToken: config.relayHostToken,
      deps,
    });
    tunnel.on("state", (state, detail) => {
      console.log(`[relay] ${state}${detail ? `: ${detail}` : ""}`);
      status.update({ relay: { state, detail } });
    });
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
    status.clear();
    tunnel?.stop();
    devices.unwatch();
    tracker.stop();
    activity.flush();
    await direct.close();
    herdr.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * The server phones connect to directly, on the routes that are on. Tailscale
 * only: it listens on the Tailscale address, and moves when that changes.
 */
class DirectServer {
  port: number;
  private server: LocalServer | null = null;
  private bind: string | null = null;
  private watch: NodeJS.Timeout | null = null;

  private readonly config: HostConfig;
  private readonly routes: Routes;
  private readonly deps: SessionDeps;

  constructor(config: HostConfig, routes: Routes, deps: SessionDeps) {
    this.config = config;
    this.routes = routes;
    this.deps = deps;
    this.port = config.port;
  }

  async start(): Promise<void> {
    await this.listen();
    if (!this.routes.lan && this.routes.tailscale) this.watch = setInterval(() => void this.listen().catch(() => {}), TAILSCALE_WATCH_MS);
  }

  async close(): Promise<void> {
    if (this.watch) clearInterval(this.watch);
    await this.server?.close();
    this.server = null;
  }

  private async listen(): Promise<void> {
    const bind = listenAddress(this.config.bind, this.routes);
    if (bind === this.bind) return;
    await this.server?.close();
    this.server = null;
    this.bind = bind;
    if (!bind) {
      if (this.routes.tailscale && !this.routes.lan) console.log("Waiting for a Tailscale address…");
      return;
    }
    this.server = await startLocalServer({ port: this.config.port, bind, deps: this.deps, accepts: (local) => accepts(this.routes, local) });
    this.port = this.server.port;
    if (!this.routes.lan) console.log(`Listening on Tailscale only (${bind})`);
  }
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
  if (config.disabled) {
    console.log(`Shepherd is turned off, so the host isn't started. Turn it on in the Shepherd window or with: ${hostCommand("on")}`);
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
  console.log(await restartHost(loadConfig().configPath));
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
    case "on":
      return console.log(await turnOn(loadConfig().configPath));
    case "off":
      try {
        return console.log(await turnOff(loadConfig().configPath));
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    case "status":
      return statusCommand();
    case "ui": {
      const screen = argv[1] ?? process.env.SHEPHERD_SCREEN ?? "overview";
      if (!(SCREENS as readonly string[]).includes(screen)) {
        console.error(`Usage: ui [${SCREENS.join("|")}]`);
        process.exit(2);
      }
      return runWindow(screen as Screen);
    }
    case "info": {
      const config = loadConfig();
      return printHostInfo(config, new DeviceRegistry(config.configPath));
    }
    case "pair": {
      const config = loadConfig();
      return printPairing(config, new DeviceRegistry(config.configPath));
    }
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
    case "connections": {
      const config = loadConfig();
      const wanted = argv.slice(1).map((a) => a.toLowerCase());
      if (wanted.length === 0) {
        const routes = routesOf(config);
        for (const r of ROUTES) console.log(`  ${ROUTE_LABELS[r].padEnd(10)} ${routes[r] ? "on" : "off"}`);
        console.log(`\nChoose with: ${hostCommand("connections")} <${ROUTES.join("|")}>…   e.g. connections tailscale relay`);
        return;
      }
      const unknown = wanted.filter((w) => !(ROUTES as readonly string[]).includes(w));
      if (unknown.length) {
        console.error(`Unknown: ${unknown.join(", ")}. Choose from: ${ROUTES.join(", ")}`);
        process.exit(2);
      }
      let routes: Routes;
      try {
        routes = checkRoutes(config, { lan: wanted.includes("lan"), tailscale: wanted.includes("tailscale"), relay: wanted.includes("relay") }, wanted as Route[]);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(2);
      }
      console.log(await setConnections(config.configPath, routes));
      return;
    }
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
