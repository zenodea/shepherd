import { networkInterfaces } from "node:os";
import type { TerminalMode } from "@sheperd/protocol";
import { AgentTracker } from "./agent-tracker.ts";
import { generateSecret, loadConfig, loadOrCreateStoredConfig, saveStoredConfig, type HostConfig } from "./config.ts";
import { HerdrClient } from "./herdr-client.ts";
import { RelayTunnel, appRelayUrl } from "./relay-tunnel.ts";
import { startLocalServer } from "./server.ts";
import type { SessionDeps } from "./session.ts";
import { TerminalStream } from "./terminal-stream.ts";

const USAGE = `sheperd-host — bridge your herdr agents to the sheperd app

Usage:
  npm start -w host                 Run the host (default)
  npm start -w host -- info         Show connection details (URL + token)
  npm start -w host -- rotate-token Issue a new app token (disconnects old apps)
  npm start -w host -- relay <relay-url> <relay-host-token>
                                    Also connect through a sheperd relay
  npm start -w host -- relay off    Stop using the relay

Environment:
  SHEPERD_PORT   Port for direct connections (default 7420)
  SHEPERD_BIND   Address to listen on (default 0.0.0.0)
  SHEPERD_TOKEN  Override the stored app token
  SHEPERD_CONFIG Config file (default ~/.config/sheperd/host.json)
  HERDR_BIN      herdr binary (default "herdr" on PATH)
  HERDR_SESSION / HERDR_SOCKET_PATH  Target a named herdr session or socket
`;

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
}

function printConnectionInfo(config: HostConfig, port = config.port): void {
  const addresses = config.bind === "0.0.0.0" ? lanAddresses() : [config.bind];
  console.log(`\n  Host:   ${config.name} (${config.hostId})`);
  for (const address of addresses) console.log(`  URL:    ws://${address}:${port}/connect`);
  if (config.relayUrl) console.log(`  Relay:  ${appRelayUrl(config.relayUrl, config.hostId)}`);
  console.log(`  Token:  ${config.token}`);
  console.log(`  Config: ${config.configPath}\n`);
}

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
    host: { name: config.name, herdrVersion },
    openTerminal: (paneId: string, mode: TerminalMode, cols: number, rows: number) =>
      new TerminalStream({ herdrBin: config.herdrBin, socketPath: config.socketPath, paneId, mode, cols, rows }),
  };

  const server = await startLocalServer({ port: config.port, bind: config.bind, token: config.token, deps });
  console.log(`sheperd-host connected to herdr ${herdrVersion}, tracking ${tracker.list().length} agent(s).`);
  printConnectionInfo(config, server.port);

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
