import type { TerminalMode } from "@sheperd/protocol";
import { AgentTracker } from "./agent-tracker.ts";
import { generateSecret, loadConfig, loadOrCreateStoredConfig, saveStoredConfig, type HostConfig } from "./config.ts";
import { HerdrClient } from "./herdr-client.ts";
import { Launcher } from "./launcher.ts";
import { Notifier, ntfyBase, ntfySubscribeUrl } from "./notifier.ts";
import { printConnectionInfo, renderQr } from "./pairing.ts";
import { RelayTunnel, appRelayUrl } from "./relay-tunnel.ts";
import { startLocalServer } from "./server.ts";
import type { SessionDeps } from "./session.ts";
import { TerminalStream } from "./terminal-stream.ts";

const USAGE = `sheperd-host — bridge your herdr agents to the sheperd app

Usage:
  npm start -w host                 Run the host (default)
  npm start -w host -- info         Show the pairing QR code, URLs and token
  npm start -w host -- rotate-token Issue a new app token (disconnects old apps)
  npm start -w host -- relay <relay-url> <relay-host-token>
                                    Also connect through a sheperd relay
  npm start -w host -- relay off    Stop using the relay
  npm start -w host -- notify on [ntfy-server]
                                    Push notifications via ntfy (default https://ntfy.sh)
  npm start -w host -- notify test  Send a test notification
  npm start -w host -- notify off   Stop notifications

Environment:
  SHEPERD_PORT   Port for direct connections (default 7420)
  SHEPERD_BIND   Address to listen on (default 0.0.0.0)
  SHEPERD_TOKEN  Override the stored app token
  SHEPERD_CONFIG Config file (default ~/.config/sheperd/host.json)
  HERDR_BIN      herdr binary (default "herdr" on PATH)
  HERDR_SESSION / HERDR_SOCKET_PATH  Target a named herdr session or socket
`;

async function serve(config: HostConfig): Promise<void> {
  const herdr = new HerdrClient(config.socketPath);
  let herdrVersion = "unknown";
  try {
    herdrVersion = (await herdr.request<{ version: string }>("ping")).version;
  } catch (err) {
    console.error(`Can't reach herdr at ${config.socketPath}: ${(err as Error).message}`);
    console.error("Start herdr first (run `herdr`), or set HERDR_SESSION / HERDR_SOCKET_PATH.");
    process.exit(1);
  }

  const tracker = new AgentTracker(herdr);
  tracker.on("error", (err) => console.error(`[herdr] ${err.message}`));
  tracker.on("status", (c) => console.log(`[agent] ${c.paneId} ${c.previous ?? "?"} → ${c.status}`));
  await tracker.start();

  const deps: SessionDeps = {
    herdr,
    tracker,
    host: { name: config.name, herdrVersion, notifyUrl: config.notify ? ntfySubscribeUrl(config.notify) : undefined },
    openTerminal: (paneId: string, mode: TerminalMode, cols: number, rows: number) =>
      new TerminalStream({ herdrBin: config.herdrBin, socketPath: config.socketPath, paneId, mode, cols, rows }),
    launcher: new Launcher({ herdr, onError: (err) => console.error(`[launch] ${err.message}`) }),
  };

  const server = await startLocalServer({ port: config.port, bind: config.bind, token: config.token, deps });
  console.log(`sheperd-host connected to herdr ${herdrVersion}, tracking ${tracker.list().length} agent(s).`);
  await printConnectionInfo(config, server.port);

  if (config.notify) {
    const notifier = new Notifier({
      config: config.notify,
      hostName: config.name,
      onError: (err) => console.error(`[notify] ${err.message}`),
    });
    notifier.attach(tracker);
    console.log(`Notifications on: ${ntfyBase(config.notify.server)}/${config.notify.topic}`);
  }

  let tunnel: RelayTunnel | null = null;
  if (config.relayUrl && config.relayHostToken) {
    tunnel = new RelayTunnel({
      relayUrl: config.relayUrl,
      hostId: config.hostId,
      hostToken: config.relayHostToken,
      clientToken: config.token,
      deps,
    });
    tunnel.on("state", (state, detail) => console.log(`[relay] ${state}${detail ? `: ${detail}` : ""}`));
    tunnel.start();
  }

  const shutdown = async () => {
    tunnel?.stop();
    tracker.stop();
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
    const notify = stored.notify?.server === server ? stored.notify : { server, topic: `sheperd-${generateSecret(15)}` };
    saveStoredConfig(config.configPath, { ...stored, notify });
    const subscribe = ntfySubscribeUrl(notify);
    console.log("\n  Notifications enabled. On your phone:");
    console.log("   1. Install ntfy (https://ntfy.sh, Play Store or F-Droid)");
    console.log("   2. Scan this with your camera, or tap Host → Get notifications in sheperd:\n");
    console.log((await renderQr(subscribe)).trimEnd().replace(/^/gm, "  ") + "\n");
    console.log(`  Topic: ${ntfyBase(notify.server)}/${notify.topic}`);
    console.log("  Treat the topic like a password: anyone who knows it can read your notifications.");
    console.log("  Restart the host to apply.\n");
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
      console.error("Notifications are off. Run: npm start -w host -- notify on");
      process.exit(1);
    }
    let failed: Error | null = null;
    await new Notifier({ config: stored.notify, hostName: config.name, onError: (e) => (failed = e) }).publish({
      topic: stored.notify.topic,
      title: "sheperd test",
      message: `Notifications from ${config.name} are working.`,
      priority: 3,
      tags: ["tada"],
      click: "sheperd://",
    });
    if (failed) {
      console.error(`Failed: ${(failed as Error).message}`);
      process.exit(1);
    }
    console.log("Sent. Check your phone.");
    return;
  }
  console.error("Usage: notify on [ntfy-server] | notify off | notify test");
  process.exit(2);
}

async function main(argv: string[]): Promise<void> {
  const [command = "serve"] = argv;
  switch (command) {
    case "serve":
      return serve(loadConfig());
    case "info":
      return printConnectionInfo(loadConfig());
    case "rotate-token": {
      const config = loadConfig();
      const stored = loadOrCreateStoredConfig(config.configPath);
      saveStoredConfig(config.configPath, { ...stored, token: generateSecret() });
      console.log("New token issued. Restart the host, then re-enter the token in the app.");
      return printConnectionInfo(loadConfig());
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
      console.log("Relay saved. Restart the host to connect.");
      return printConnectionInfo(loadConfig());
    }
    case "notify":
      return notifyCommand(argv.slice(1));
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
