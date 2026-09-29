# sheperd

Check on and steer your [herdr](https://herdr.dev) agents from your Android phone: see which agents need input, read their output, answer prompts, and send new instructions.

```
 ┌──────── Your computer ─────────┐                                   ┌──── Phone ─────┐
 │ herdr ◄── herdr.sock ── host ══╪═══ same Wi-Fi / Tailscale ═══════►│ sheperd app    │
 │                                 ║                                   │                │
 │                                 ╚══► relay (Cloudflare, optional) ◄═╪═ from anywhere │
 └─────────────────────────────────┘                                   └────────────────┘
```

- **host**: a small Node service on your computer. It talks to herdr's local socket and lets the app in with a token.
- **app**: the Android app (Expo / React Native).
- **relay** (optional): a Cloudflare Worker you deploy yourself. It lets your phone reach your computer from anywhere, with no port forwarding.

## Quick start

### 1. Prerequisites

- [herdr](https://herdr.dev) 0.9 or newer, running (just run `herdr`)
- [Node.js](https://nodejs.org) 22.18 or newer
- An Android phone

### 2. Install

```bash
git clone <this repo> sheperd
cd sheperd
npm install
```

### 3. Start the host on your computer

```bash
npm start -w host
```

It prints a **pairing QR code**, followed by the addresses it can be reached on:

```
  Scan with the sheperd app (Connect → Scan QR code):

  ▄▄▄▄▄▄▄ ▄▄▄▄▄ ▄   ▄▄▄▄ …

  Host:      my-laptop (ENUEyLClAden)
  LAN:       ws://192.168.1.20:7420/connect
  Tailscale: ws://100.95.112.5:7420/connect
  Token:     Zb3…
```

The QR code holds the host's name, its token and every address above. The token is created on first run and stored in `~/.config/sheperd/host.json` (readable only by you). Run `npm start -w host -- info` to show the QR code again.

### 4. Get the app on your phone

Pick one of the three options below.

**Option A: Build an APK in the cloud (easiest, free Expo account)**

```bash
npx eas-cli@latest login
npm run build:apk -w app
```

The first run asks to create the EAS project. When the build finishes, open the link it prints on your phone and install the APK. You may need to allow installing apps from your browser.

**Option B: Build the APK locally** (needs JDK 17 and the Android SDK, e.g. via Android Studio)

```bash
npm run build:apk:local -w app
adb install app/android/app/build/outputs/apk/release/app-release.apk
```

This APK is signed with the debug key, which is fine for personal use but not for the Play Store.

**Option C: Try it without building (development)**

Install **Expo Go** from the Play Store, run `npm start -w app`, and scan the QR code **from inside the Expo Go app**. The app is Android-first and doesn't run in a web browser.

If Expo Go can't load the project, your phone probably can't reach your computer at the `exp://…:8081` address Metro prints. This happens on guest, office and university Wi-Fi. If both devices are on Tailscale, use your computer's Tailscale IP instead:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=100.x.y.z npm start -w app
```

### 5. Connect

Open the app, tap **Scan QR code**, and point the camera at the QR code from step 3. If you installed the APK, scanning with your phone's own camera app works too.

The app tries every address in the QR code at once and uses whichever answers first. It works at home, on Tailscale or through the relay without you choosing, and it switches over when you change networks. If you can't scan, choose **Enter address and token manually**.

## What you can do

- **See every agent at a glance.** Agents that need input are listed first. For each one, the list shows what it's asking, such as "Do you want to make this edit?", with one button per answer. Tap an answer to reply without opening the agent.
- **Watch the live terminal.** Tap an agent to see its screen as it updates.
  - **Full width** shows the pane exactly as it looks on your computer, scaled to fit. Pinch to zoom.
  - **Fit to phone** reflows the agent to your screen size so it's readable, and lets you type into it directly. Your computer's pane goes back to its normal size when you leave.
- **Steer it.** Send a message, or use the quick keys: Enter, Esc, arrows, `1`/`2`/`3`, `y`/`n`, Ctrl-C.
- **Start new agents.** Tap **+ New** and pick an agent (whichever of claude, codex, gemini, … are installed) and a project. It can start in a new git worktree so parallel agents don't collide, and you can give it a first message.
- **Get notified** when an agent needs input or finishes, even when the app is closed. See below.

## Notifications

Notifications go through [ntfy](https://ntfy.sh), a free and open-source push service. There's no Firebase or Google account to set up.

```bash
npm start -w host -- notify on       # or: notify on https://your-ntfy-server
npm start -w host                    # restart to apply
```

1. Install **ntfy** on your phone (Play Store or F-Droid).
2. Scan the QR code that `notify on` prints, or in sheperd open **Host → Get notifications (ntfy)**.
3. Run `npm start -w host -- notify test` to check it works.

You'll get a high-priority notification when an agent needs input, and a normal one when a working agent finishes. Tapping a notification opens that agent in sheperd (APK builds; Expo Go can't receive `sheperd://` links).

The topic name is random and acts as the password. Notifications contain the agent's name and terminal title. Use a self-hosted ntfy server if you'd rather they didn't pass through ntfy.sh. In the ntfy app, turn on *instant delivery* for real-time notifications.

## Using it away from home

Your phone has to reach the host. There are two ways.

### Tailscale (simplest)

Install [Tailscale](https://tailscale.com) on your computer and phone. The host detects its Tailscale address and puts it in the QR code automatically, so there's nothing to configure. Just make sure Tailscale is switched on on your phone.

### Your own relay (no VPN on the phone)

Deploy the relay to your Cloudflare account. The free Workers plan is enough for personal use.

```bash
cd relay
npx wrangler login
openssl rand -base64 32              # copy this: it's your relay host token
npx wrangler secret put HOST_TOKEN   # paste it
npm run deploy                       # prints https://sheperd-relay.<you>.workers.dev
cd ..

npm start -w host -- relay https://sheperd-relay.<you>.workers.dev <relay host token>
npm start -w host
```

The QR code now includes the relay address too. Scan it again (Host → **Scan a new QR code**) and the app will use the relay whenever your computer isn't reachable directly.

How it works:
- The host keeps one outbound connection open to the relay.
- When the app connects, the relay asks the host to dial back, then pipes the two connections together.
- The host sends the relay only a SHA-256 hash of the app token, never the token itself.

> **Note:** until end-to-end encryption lands (see the roadmap), traffic is encrypted between each device and Cloudflare but is readable inside your own Worker. Only deploy the relay to an account you control.

## Host commands

```bash
npm start -w host                      # run
npm start -w host -- info              # show the pairing QR code, addresses and token
npm start -w host -- rotate-token      # new app token (scan the new QR code in the app)
npm start -w host -- relay <url> <tok> # connect through a relay
npm start -w host -- relay off         # stop using the relay
npm start -w host -- notify on [url]   # push notifications via ntfy
npm start -w host -- notify test       # send a test notification
npm start -w host -- notify off        # stop notifications
```

| Variable | Default | |
|---|---|---|
| `SHEPERD_PORT` | `7420` | Port for direct connections |
| `SHEPERD_BIND` | `0.0.0.0` | Use `127.0.0.1` if you only want relay access |
| `SHEPERD_TOKEN` | stored | Override the app token |
| `SHEPERD_CONFIG` | `~/.config/sheperd/host.json` | Config file |
| `HERDR_SESSION` / `HERDR_SOCKET_PATH` | default session | Target another herdr session |
| `HERDR_BIN` | `herdr` | herdr binary |

## Security model

- The app authenticates to the host with a random 256-bit token.
- The host forwards only a fixed allowlist of herdr methods: listing, reading, prompting, sending keys, renaming and focusing agents. See `FORWARDED_METHODS` in `packages/protocol/src/wire.ts`.
- Starting agents goes through a narrow host method rather than raw herdr calls. It only accepts an agent type herdr supports that is installed on the computer, and only in the directory of an existing herdr workspace.
- A leaked token can't run arbitrary shell commands through the API, but it *can* type into your agents and terminals. Treat it like an SSH key, and use `rotate-token` if it leaks.
- On the LAN, traffic is plain `ws://`. Use Tailscale or the relay (`wss://`) on networks you don't trust.

## Development

```bash
npm run typecheck   # all workspaces
npm test            # protocol, host, app client and relay end-to-end tests
npm run lint        # app lint
npm run dev -w host # host with auto-reload
npm run dev -w relay # relay locally (copy relay/.dev.vars.example to relay/.dev.vars)
```

| Path | What it is |
|---|---|
| `packages/protocol` | Message types shared by everything: the herdr API subset, app↔host messages, relay tunnel messages |
| `host` | herdr socket client, agent status tracker, WebSocket server, relay tunnel, agent launcher, ntfy notifier |
| `relay` | Worker plus one `HostRoom` Durable Object per host |
| `app` | Expo Router app (`src/app` holds the screens). The terminal is xterm.js in a WebView. `npm install` inlines xterm into `src/terminal/terminal-html.generated.ts` so it works offline |

How the host talks to herdr:
- **Agents and events:** herdr's socket API (`herdr api schema --json`). herdr answers one request per connection.
- **Live terminals:** `herdr terminal session observe|control`, which streams screen frames as newline-delimited JSON.

## Roadmap

1. [x] Host bridge: agent list, live status, read output, prompts, keys
2. [x] Relay: routing and splicing, host tunnel
3. [x] Android app: agent list, quick keys, prompts
4. [x] Live terminal view (full width or fit to phone)
5. [x] Push notifications when an agent is `blocked` or `done` (ntfy)
6. [x] QR-code pairing (host QR, in-app scanner, `sheperd://` deep link)
7. [x] Answer blocked agents from the list
8. [x] Start new agents (new tab or git worktree)
9. [ ] Per-device tokens and revocation
10. [ ] End-to-end encryption between phone and host, so the relay sees only ciphertext
11. [ ] Run the host in the background (launchd / systemd units)
