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

It prints something like:

```
sheperd-host connected to herdr 0.9.1, tracking 3 agent(s).

  Host:   my-laptop (ENUEyLClAden)
  URL:    ws://192.168.1.20:7420/connect
  Token:  Zb3…
```

The token is created on first run and stored in `~/.config/sheperd/host.json` (readable only by you). Run `npm start -w host -- info` to see it again.

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

Open the app, then paste the **URL** and **Token** from step 3. Your agents appear, with the ones needing input at the top. Tap an agent to:

- see its recent output
- answer prompts with quick keys: Enter, Esc, arrows, `1`/`2`/`3`, `y`/`n`, Ctrl-C
- send it a message

## Using it away from home

Your phone has to reach the host. There are two ways.

### Tailscale (simplest)

Install [Tailscale](https://tailscale.com) on your computer and phone, then use the host's Tailscale address in the app, e.g. `ws://100.101.102.103:7420/connect`. Nothing else changes.

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

The host now also prints a `Relay:` URL. Use that URL in the app, with the same token as before.

How it works:
- The host keeps one outbound connection open to the relay.
- When the app connects, the relay asks the host to dial back, then pipes the two connections together.
- The host sends the relay only a SHA-256 hash of the app token, never the token itself.

> **Note:** until end-to-end encryption lands (see the roadmap), traffic is encrypted between each device and Cloudflare but is readable inside your own Worker. Only deploy the relay to an account you control.

## Host commands

```bash
npm start -w host                      # run
npm start -w host -- info              # show URL, relay URL and token
npm start -w host -- rotate-token      # new app token (re-enter it in the app)
npm start -w host -- relay <url> <tok> # connect through a relay
npm start -w host -- relay off         # stop using the relay
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
- The host forwards only a fixed allowlist of herdr methods: listing, reading, prompting, sending keys, renaming and focusing agents. See `FORWARDED_METHODS` in `packages/protocol/src/wire.ts`. A leaked token can't run shell commands through `pane.run` or plugins, but it *can* type into your agents. Treat it like an SSH key, and use `rotate-token` if it leaks.
- On the LAN, traffic is plain `ws://`. Use Tailscale or the relay (`wss://`) on networks you don't trust.

## Development

```bash
npm run typecheck   # all workspaces
npm test            # protocol + host unit tests, relay end-to-end tests (runs the Worker locally)
npm run dev -w host # host with auto-reload
npm run dev -w relay # relay locally (copy relay/.dev.vars.example to relay/.dev.vars)
```

| Path | What it is |
|---|---|
| `packages/protocol` | Message types shared by everything: the herdr API subset, app↔host messages, relay tunnel messages |
| `host` | herdr socket client, agent status tracker, WebSocket server, relay tunnel |
| `relay` | Worker plus one `HostRoom` Durable Object per host |
| `app` | Expo Router app (`src/app` holds the screens) |

The host uses herdr's socket API (`herdr api schema --json`) for agents and events. Live terminals use `herdr terminal session observe|control`, which streams screen frames as newline-delimited JSON. The host already supports these streams, and the app will use them for the live terminal view.

## Roadmap

1. [x] Host bridge: agent list, live status, read output, prompts, keys
2. [x] Relay: routing and splicing, host tunnel
3. [x] Android app: agent list, output view, quick keys, prompts
4. [ ] Live terminal view (xterm.js in a WebView, using the host's terminal streams)
5. [ ] Push notifications when an agent is `blocked` or `done` (FCM or ntfy)
6. [ ] QR-code pairing with per-device tokens and revocation
7. [ ] End-to-end encryption between phone and host, so the relay sees only ciphertext
8. [ ] Run the host in the background (launchd / systemd units)
