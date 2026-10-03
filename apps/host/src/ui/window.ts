// The Shepherd window: a full-screen view of the host for a herdr plugin pane
// (or any terminal). Overview, pairing with the QR code, paired phones, log.
import { existsSync, readFileSync } from "node:fs";
import { encodePairingLink } from "@shepherd/protocol";
import { DeviceRegistry, type Device } from "../pairing/devices.ts";
import { hostAddresses, pairingInfo, renderQr, type HostAddress } from "../pairing/pairing.ts";
import { loadConfig, type HostConfig } from "../system/config.ts";
import { readRunningHost, restartHost, setConnections, turnOff, turnOn, type RunningHost } from "../system/daemon.ts";
import { ROUTE_LABELS, ROUTES, routesOf, withRoute, type Route, type Routes } from "../connection/routes.ts";
import { readHostStatus, type ConnectedPhone, type HostStatus } from "../system/host-status.ts";
import { Service } from "../system/service.ts";
import { duration, frame, pad, screen, style, visibleLength, when } from "./ansi.ts";

export const SCREENS = ["overview", "pair", "phones", "log"] as const;
export type Screen = (typeof SCREENS)[number];

const TABS: Record<Screen, { key: string; label: string }> = {
  overview: { key: "o", label: "Overview" },
  pair: { key: "p", label: "Pair" },
  phones: { key: "d", label: "Phones" },
  log: { key: "l", label: "Log" },
};

export type WindowData = {
  name: string;
  running: RunningHost | null;
  /** What the running host last reported; null when it isn't running. */
  status: HostStatus | null;
  service: { installed: boolean; detail: string };
  /** Turned off here: the host is stopped and herdr won't start it. */
  turnedOff: boolean;
  devices: Device[];
  addresses: HostAddress[];
  routes: Routes;
  relayConfigured: boolean;
  log: string[];
  logFile: string;
};

export type Flash = { text: string; tone: "ok" | "warn" | "error" };
export type Pairing = { qr: string[]; code: string; expiresAt: number } | { error: string };

export type ViewState = {
  screen: Screen;
  selected: number;
  confirmRevoke: string | null;
  flash: Flash | null;
  pairing: Pairing | null;
  now: number;
};

export type PhoneRow = { device: Device; connections: ConnectedPhone[] };

/** Connected phones first, then the most recently seen. */
export function phoneRows(data: WindowData): PhoneRow[] {
  const connected = data.status?.phones ?? [];
  return data.devices
    .map((device) => ({ device, connections: connected.filter((c) => c.deviceId === device.id) }))
    .sort((a, b) => {
      if (a.connections.length !== b.connections.length) return b.connections.length - a.connections.length;
      return (b.device.lastSeenAt ?? b.device.createdAt).localeCompare(a.device.lastSeenAt ?? a.device.createdAt);
    });
}

const label = (s: string) => style.dim(pad(s, 15));

/** A key to press: [s], with the letter in the accent colour. */
export const keycap = (key: string) => `${style.dim("[")}${style.bold(style.cyan(key))}${style.dim("]")}`;
/** An on/off slider: knob right and green when on, left and grey when off (red if it should be on but isn't). */
const slider = (on: boolean, broken = false) =>
  on ? style.green("━━━● on ") : broken ? style.red("●━━━ off") : style.dim("●━━━ off");
/** A switch with the key that flips it, then what it's about. */
const switchRow = (name: string, slide: string, key: string | null, detail: string) =>
  `  ${label(name)}${slide}    ${key ? keycap(key) : "   "}   ${detail}`;

function stateText(data: WindowData): string {
  if (data.running) return style.green("● on");
  return data.turnedOff ? style.dim("○ off") : style.red("○ not running");
}

function overview(data: WindowData, now: number): string[] {
  const { running, status } = data;
  const lines: string[] = [];
  lines.push(`  ${label("Host")}${data.name}`);
  // The background service keeps the host running itself, so there's no switch for it here.
  const key = data.service.installed ? null : "s";
  if (running) {
    lines.push(switchRow("Shepherd", slider(true), key, style.dim(`running for ${duration(now - Date.parse(running.startedAt))} · pid ${running.pid}`)));
  } else if (data.turnedOff) {
    lines.push(switchRow("Shepherd", slider(false), key, style.dim("phones can't connect, and herdr won't start it")));
  } else {
    lines.push(switchRow("Shepherd", slider(false, true), key, style.red("not running")));
  }
  if (data.service.installed) lines.push(`  ${label("")}${style.dim(`Run by the background service (${data.service.detail})`)}`);
  lines.push(`  ${label("herdr")}${status ? `${status.herdr.version}${style.dim(` · ${status.herdr.socketPath}`)}` : style.dim("—")}`);
  if (status) {
    const { total, blocked, working } = status.agents;
    const parts = [`${total}`, blocked ? style.yellow(`${blocked} need${blocked === 1 ? "s" : ""} you`) : "", working ? `${working} working` : ""];
    lines.push(`  ${label("Agents")}${parts.filter(Boolean).join(style.dim(" · "))}`);
  } else {
    lines.push(`  ${label("Agents")}${style.dim("—")}`);
  }
  const connected = new Set((status?.phones ?? []).map((p) => p.deviceId)).size;
  lines.push(`  ${label("Phones")}${status ? `${connected} connected` : style.dim("—")}${style.dim(` · ${data.devices.length} paired`)}`);
  lines.push("");
  lines.push(`  ${style.bold("Phones connect over")}`);
  for (const [route, key] of [["lan", "1"], ["tailscale", "2"], ["relay", "3"]] as const) {
    const on = data.routes[route];
    const urls = data.addresses.filter((a) => a.label === ROUTE_LABELS[route]).map((a) => a.url);
    const detail = route === "relay" ? relayText(data) : !on ? style.dim("off") : urls[0] ?? style.dim(`no ${ROUTE_LABELS[route]} address`);
    lines.push(switchRow(ROUTE_LABELS[route], slider(on && (route !== "relay" || data.relayConfigured)), key, detail));
    if (route !== "relay") for (const url of urls.slice(1)) lines.push(`  ${label("")}${" ".repeat(16)}${url}`);
  }
  return lines;
}

function relayText(data: WindowData): string {
  if (!data.relayConfigured) return style.dim("not set up");
  if (!data.routes.relay) return style.dim("off");
  const relay = data.status?.relay;
  if (!data.running) return style.dim("configured");
  if (!relay) return style.dim("starting");
  if (relay.state === "online") return style.green("online");
  if (relay.state === "connecting") return style.yellow("connecting");
  return style.red(`${relay.state}${relay.detail ? `: ${relay.detail}` : ""}`);
}

function pairScreen(view: ViewState, data: WindowData, cols: number, height: number): string[] {
  const lines: string[] = [];
  if (!data.running) {
    lines.push(`  ${style.yellow("Shepherd is off, so a phone can't connect yet.")} Turn it on with ${style.bold("s")} on the Overview.`, "");
  }
  const pairing = view.pairing;
  if (!pairing) return [...lines, style.dim("  Creating a pairing code…")];
  if ("error" in pairing) return [...lines, `  ${style.red(pairing.error)}`];
  const left = pairing.expiresAt - view.now;
  if (left <= 0) return [...lines, `  ${style.yellow("This code has expired.")} Press ${style.bold("p")} for a new one.`];
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  lines.push(`  Scan with the Shepherd app (Host → Scan QR code). One-time code, valid for ${m}:${String(s).padStart(2, "0")}.`);
  const manual = `  ${style.dim(`Or enter it by hand: ${pairing.code}`)}`;
  const qrWidth = Math.max(...pairing.qr.map(visibleLength));
  if (qrWidth + 2 > cols || lines.length + pairing.qr.length + 1 > height) {
    return [...lines, "", style.yellow("  Make this window bigger to show the QR code."), manual];
  }
  return [...lines, ...pairing.qr.map((l) => `  ${l}`), manual];
}

function phonesScreen(view: ViewState, data: WindowData, now: number): string[] {
  const rows = phoneRows(data);
  if (rows.length === 0) return [`  No phones paired yet. Press ${style.bold("p")} to pair one.`];
  const nameWidth = Math.min(28, Math.max(...rows.map((r) => r.device.name.length)) + 2);
  return rows.map(({ device, connections }, i) => {
    const selected = i === view.selected;
    const dot = connections.length ? style.green("●") : style.dim("○");
    let detail: string;
    if (connections.length) {
      const first = connections[0]!;
      const via = connections.some((c) => c.via === "direct") ? "direct" : "through the relay";
      detail = `${style.green("connected")}${style.dim(` · ${via} · since ${when(first.since, now)}`)}`;
    } else {
      detail = style.dim(device.lastSeenAt ? `last seen ${when(device.lastSeenAt, now)}` : "never connected");
    }
    const short = device.name.length > nameWidth - 2 ? `${device.name.slice(0, nameWidth - 3)}…` : device.name;
    const name = selected ? style.bold(pad(short, nameWidth)) : pad(short, nameWidth);
    return `${selected ? style.cyan(" › ") : "   "}${dot} ${name}${detail}  ${style.dim(device.id)}`;
  });
}

function logScreen(data: WindowData, height: number): string[] {
  const lines = [`  ${style.dim(data.logFile)}`, ""];
  if (data.log.length === 0) return [...lines, style.dim("  Nothing logged yet.")];
  return [...lines, ...data.log.slice(-(height - 2)).map((l) => `  ${l}`)];
}

const HINTS: Record<Screen, [string, string][]> = {
  overview: [["s", "shepherd on/off"], ["1-3", "connections"], ["r", "restart"], ["q", "close"]],
  pair: [["p", "new code"], ["r", "restart"], ["q", "close"]],
  phones: [["↑↓", "select"], ["x", "revoke"], ["p", "pair"], ["q", "close"]],
  log: [["r", "restart"], ["q", "close"]],
};

const hints = (screen: Screen) => "  " + HINTS[screen].map(([key, what]) => `${keycap(key)} ${style.dim(what)}`).join("  ");

export function render(view: ViewState, data: WindowData, cols: number, rows: number): string[] {
  const header = `  ${style.bold("Shepherd")}  ${stateText(data)}${style.dim(` · ${data.name}`)}`;
  const tabs =
    "  " +
    SCREENS.map((s) => (s === view.screen ? `${keycap(TABS[s].key)} ${style.bold(style.underline(TABS[s].label))}` : `${style.dim(`[${TABS[s].key}]`)} ${style.dim(TABS[s].label)}`)).join("   ");
  const top = [header, "", tabs, style.dim("─".repeat(cols)), ""];
  const bodyHeight = Math.max(0, rows - top.length - 3);

  let body: string[];
  switch (view.screen) {
    case "overview":
      body = overview(data, view.now);
      break;
    case "pair":
      body = pairScreen(view, data, cols, bodyHeight);
      break;
    case "phones":
      body = phonesScreen(view, data, view.now);
      break;
    case "log":
      body = logScreen(data, bodyHeight);
      break;
  }
  body = body.slice(0, bodyHeight);
  while (body.length < bodyHeight) body.push("");

  let message = "";
  if (view.confirmRevoke) {
    const device = data.devices.find((d) => d.id === view.confirmRevoke);
    message = style.yellow(`  Revoke ${device?.name ?? view.confirmRevoke}? It's disconnected at once and has to pair again.  y yes · n no`);
  } else if (view.flash) {
    const tone = view.flash.tone === "ok" ? style.green : view.flash.tone === "warn" ? style.yellow : style.red;
    message = `  ${tone(view.flash.text)}`;
  }
  return [...top, ...body, "", message, hints(view.screen)];
}

const LOG_LINES = 200;

function tail(path: string): string[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  return text.slice(-64 * 1024).trimEnd().split("\n").slice(-LOG_LINES);
}

/** Run the window until the person closes it. */
export async function runWindow(initial: Screen = "overview"): Promise<void> {
  let config = loadConfig();
  const devices = new DeviceRegistry(config.configPath);
  devices.watch(500);
  const service = new Service();
  const out = process.stdout;
  const input = process.stdin;

  const load = (): WindowData => {
    const running = readRunningHost(config.configPath);
    const status = readHostStatus(config.configPath, running?.pid ?? null);
    const svc = service.status();
    return {
      name: config.name,
      running,
      status,
      service: { installed: svc.installed, detail: svc.detail },
      turnedOff: config.disabled === true,
      devices: devices.list(),
      addresses: status?.addresses ?? hostAddresses(config, config.port),
      routes: routesOf(config),
      relayConfigured: Boolean(config.relayUrl && config.relayHostToken),
      log: tail(svc.logFile),
      logFile: svc.logFile,
    };
  };

  const view: ViewState = { screen: initial, selected: 0, confirmRevoke: null, flash: null, pairing: null, now: Date.now() };
  let data = load();
  let flashTimer: NodeJS.Timeout | null = null;
  let known = new Set(data.devices.map((d) => d.id));

  const draw = () => out.write(frame(render(view, data, out.columns || 80, out.rows || 24), out.columns || 80, out.rows || 24));
  const flash = (text: string, tone: Flash["tone"] = "ok") => {
    view.flash = { text, tone };
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      view.flash = null;
      draw();
    }, 4000);
    draw();
  };
  const refresh = () => {
    view.now = Date.now();
    config = loadConfig();
    data = load();
    view.selected = Math.min(view.selected, Math.max(0, data.devices.length - 1));
    draw();
  };

  const newPairing = async () => {
    view.pairing = null;
    draw();
    try {
      const { code, expiresAt } = devices.createPairing();
      const port = data.status?.port ?? config.port;
      if (hostAddresses(config, port).length === 0) throw new Error("No reachable address: set SHEPHERD_BIND or configure a relay.");
      const qr = (await renderQr(encodePairingLink(pairingInfo(config as HostConfig, port, code)))).trimEnd().split("\n");
      view.pairing = { qr, code, expiresAt: expiresAt.getTime() };
    } catch (err) {
      view.pairing = { error: (err as Error).message };
    }
    draw();
  };
  const show = (next: Screen) => {
    view.screen = next;
    view.confirmRevoke = null;
    if (next === "pair") void newPairing();
    draw();
  };

  // A new phone paired (from this window or anywhere else): show it.
  devices.on("changed", () => {
    data = load();
    const added = data.devices.find((d) => !known.has(d.id));
    known = new Set(data.devices.map((d) => d.id));
    if (added) {
      view.screen = "phones";
      view.selected = phoneRows(data).findIndex((r) => r.device.id === added.id);
      flash(`Paired ${added.name} ✓`);
    } else draw();
  });

  let busy = false;
  const restart = async () => {
    if (busy) return;
    busy = true;
    flash("Restarting the host…", "warn");
    try {
      flash(await restartHost(config.configPath, service));
    } catch (err) {
      flash((err as Error).message, "error");
    }
    busy = false;
    setTimeout(refresh, 1500);
  };
  const toggleShepherd = async () => {
    if (busy) return;
    busy = true;
    try {
      flash(data.running ? await turnOff(config.configPath, service) : await turnOn(config.configPath, service), data.running ? "warn" : "ok");
    } catch (err) {
      flash((err as Error).message, "error");
    }
    busy = false;
    refresh();
    setTimeout(refresh, 1500);
  };
  const toggleRoute = async (route: Route) => {
    if (busy) return;
    busy = true;
    try {
      const routes = withRoute(config, route, !routesOf(config)[route]);
      flash(`${ROUTE_LABELS[route]} ${routes[route] ? "on" : "off"}: applying…`, "warn");
      flash(await setConnections(config.configPath, routes, service));
      config = loadConfig();
    } catch (err) {
      flash((err as Error).message, "error");
    }
    busy = false;
    refresh();
    setTimeout(refresh, 1500);
  };
  const close = () => {
    devices.unwatch();
    out.write(screen.leave);
    if (input.isTTY) input.setRawMode(false);
    process.exit(0);
  };

  const onKey = (key: string) => {
    if (key === "\x03") return close();
    if (view.confirmRevoke) {
      if (key === "y" || key === "Y") {
        const id = view.confirmRevoke;
        const name = data.devices.find((d) => d.id === id)?.name ?? id;
        view.confirmRevoke = null;
        devices.revoke(id);
        known.delete(id);
        flash(`Revoked ${name}.`);
        refresh();
      } else {
        view.confirmRevoke = null;
        draw();
      }
      return;
    }
    switch (key) {
      case "q":
      case "\x1b":
        return close();
      case "o":
        return show("overview");
      case "p":
        return show("pair");
      case "d":
        return show("phones");
      case "l":
        return show("log");
      case "\t":
        return show(SCREENS[(SCREENS.indexOf(view.screen) + 1) % SCREENS.length]!);
      case "\x1b[Z":
        return show(SCREENS[(SCREENS.indexOf(view.screen) + SCREENS.length - 1) % SCREENS.length]!);
      case "r":
        return void restart();
      case "s":
        if (view.screen === "overview" && !data.service.installed) void toggleShepherd();
        return;
      case "1":
      case "2":
      case "3":
        if (view.screen === "overview") void toggleRoute(ROUTES[Number(key) - 1]!);
        return;
    }
    if (view.screen === "phones") {
      const rows = phoneRows(data);
      if (key === "\x1b[A" || key === "k") view.selected = Math.max(0, view.selected - 1);
      else if (key === "\x1b[B" || key === "j") view.selected = Math.min(rows.length - 1, view.selected + 1);
      else if ((key === "x" || key === "\x7f") && rows[view.selected]) view.confirmRevoke = rows[view.selected]!.device.id;
      draw();
    }
  };

  out.write(screen.enter);
  if (input.isTTY) input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => onKey(chunk));
  out.on("resize", draw);
  process.on("SIGTERM", close);
  setInterval(refresh, 1000);
  if (view.screen === "pair") void newPairing();
  draw();
  await new Promise(() => {});
}
