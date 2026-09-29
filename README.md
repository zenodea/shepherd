# sheperd

Check on and steer your [herdr](https://herdr.dev) agents from your Android phone: see which agents need input, read their output, answer prompts, and send new instructions.

```
 ┌──────── Your computer ─────────┐                                   ┌──── Phone ─────┐
 │ herdr ◄── herdr.sock ── host ══╪═══ same Wi-Fi / Tailscale ═══════►│ sheperd app    │
 │                                 ║                                   │                │
 │                                 ╚══► relay (Cloudflare, optional) ◄═╪═ from anywhere │
 └─────────────────────────────────┘                                   └────────────────┘
```

- **host**: a small Node service on your computer. It talks to herdr's local socket and only lets in phones you've paired.
- **app**: the Android app (Expo / React Native).
- **relay** (optional): a Cloudflare Worker you deploy yourself. It lets your phone reach your computer from anywhere, with no port forwarding.

## Quick start

### 1. Prerequisites

- [herdr](https://herdr.dev) 0.9 or newer, running (just run `herdr`)
- [Node.js](https://nodejs.org) 22.18 or newer
- An Android phone

### 2. Install

```bash
git clone https://github.com/zenodea/shepherd.git
cd shepherd
npm install
```

### 3. Start the host on your computer

```bash
npm run host
```

It prints a **pairing QR code**, followed by the addresses it can be reached on:

```
  Scan with the sheperd app (Host → Scan QR code) to pair a phone:

  ▄▄▄▄▄▄▄ ▄▄▄▄▄ ▄   ▄▄▄▄ …

  One-time code, valid until 14:52. For another: npm run host -- pair

  Host:      my-laptop (ENUEyLClAden)
  LAN:       ws://192.168.1.20:7420/connect
  Tailscale: ws://100.101.102.103:7420/connect
  Code:      p_…   (for manual entry)
```

The QR code holds the host's name, every address above, and a **one-time pairing code**. The code works once and expires after 10 minutes. When your phone scans it, the host gives that phone its own token, so a photo of the QR code is useless afterwards. Run `npm run host -- pair` whenever you need a new code.

### 4. Get the app on your phone

Pick one of the three options below.

**Option A: Build an APK in the cloud (easiest, free Expo account)**

```bash
npx eas-cli@latest login
npm run build:apk -w @sheperd/mobile
```

The first run asks to create the EAS project. When the build finishes, open the link it prints on your phone and install the APK. You may need to allow installing apps from your browser.

**Option B: Build the APK locally** (needs JDK 17 and the Android SDK, e.g. via Android Studio)

```bash
npm run build:apk:local -w @sheperd/mobile
adb install apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

This APK is signed with the debug key, which is fine for personal use but not for the Play Store.

**Option C: Try it without building (development)**

Install **Expo Go** from the Play Store, run `npm run app`, and scan the QR code **from inside the Expo Go app**. The app is Android-first and doesn't run in a web browser.

If Expo Go can't load the project, your phone probably can't reach your computer at the `exp://…:8081` address Metro prints. This happens on guest, office and university Wi-Fi. If both devices are on Tailscale, use your computer's Tailscale IP instead:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=100.x.y.z npm run app
```

### 5. Connect

Open the app, tap **Scan QR code**, and point the camera at the QR code from step 3. If you installed the APK, scanning with your phone's own camera app works too.

The app tries every address in the QR code at once and uses whichever answers first. It works at home, on Tailscale or through the relay without you choosing, and it switches over when you change networks. If you can't scan, choose **Enter address and pairing code manually** and use the `Code:` line.

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
npm run host -- notify on       # or: notify on https://your-ntfy-server
npm run host                    # restart to apply
```

1. Install **ntfy** on your phone (Play Store or F-Droid).
2. Scan the QR code that `notify on` prints, or in sheperd open **Host → Get notifications (ntfy)**.
3. Run `npm run host -- notify test` to check it works.

You'll get a high-priority notification when an agent needs input, and a normal one when a working agent finishes. Tapping a notification opens that agent in sheperd (APK builds; Expo Go can't receive `sheperd://` links).

The topic name is random and acts as the password. Notifications contain the agent's name and terminal title. Use a self-hosted ntfy server if you'd rather they didn't pass through ntfy.sh. In the ntfy app, turn on *instant delivery* for real-time notifications.

## Keep the host running in the background

Once you've paired a phone, you don't need a terminal open:

```bash
npm run host -- service install   # starts now, at every login, and restarts if it stops
npm run host -- service status
npm run host -- service logs      # follow the log
npm run host -- service uninstall
```

On macOS this installs a launchd agent (`~/Library/LaunchAgents/dev.sheperd.host.plist`, logs in `~/Library/Logs/sheperd-host.log`). On Linux it's a systemd user unit (`sheperd-host.service`); run `loginctl enable-linger $USER` to keep it running while you're logged out.

- **Environment:** the service remembers the `PATH` you install it from, so it can find `herdr` and your agent CLIs. It also remembers any `SHEPERD_*` or `HERDR_SESSION` settings. Re-run `service install` after changing them.
- **Starting before herdr:** if the service starts before herdr (for example at login), it waits for herdr to come up.
- **Pairing more phones:** run `npm run host -- pair` in any terminal. The running service picks up the new code immediately.
- **Code changes:** after pulling new sheperd code, restart the service with `service install`.

## Using it away from home

Your phone has to reach the host. There are two ways.

### Tailscale (simplest)

Install [Tailscale](https://tailscale.com) on your computer and phone. The host detects its Tailscale address and puts it in the QR code automatically, so there's nothing to configure. Just make sure Tailscale is switched on on your phone.

### Your own relay (no VPN on the phone)

Deploy the relay to your Cloudflare account. The free Workers plan is enough for personal use.

```bash
cd apps/relay
npx wrangler login
openssl rand -base64 32              # copy this: it's your relay host token
npx wrangler secret put HOST_TOKEN   # paste it
npm run deploy                       # prints https://sheperd-relay.<you>.workers.dev
cd ../..

npm run host -- relay https://sheperd-relay.<you>.workers.dev <relay host token>
npm run host
```

Phones that are already paired learn the relay address the next time they connect, on Wi-Fi or Tailscale. After that they use it automatically whenever your computer isn't reachable directly. New QR codes include it too.

How it works:
- The host keeps one outbound connection open to the relay.
- When the app connects, the relay asks the host to dial back, then pipes the two connections together.
- Everything between the phone and your computer is end-to-end encrypted, so the relay only ever forwards ciphertext. See [Security model](#security-model).
- To decide who may connect at all, the relay checks a hash of each phone's token against the list the host registered. That hash is useless for logging in to the host.

## Host commands

```bash
npm run host                      # run
npm run host -- pair              # new one-time pairing QR code
npm run host -- info              # addresses and paired devices
npm run host -- devices           # list paired phones
npm run host -- devices revoke <id|all>  # unpair (disconnects immediately)
npm run host -- relay <url> <tok> # connect through a relay
npm run host -- relay off         # stop using the relay
npm run host -- notify on [url]   # push notifications via ntfy
npm run host -- notify test       # send a test notification
npm run host -- notify off        # stop notifications
```

| Variable | Default | |
|---|---|---|
| `SHEPERD_PORT` | `7420` | Port for direct connections |
| `SHEPERD_BIND` | `0.0.0.0` | Use `127.0.0.1` if you only want relay access |
| `SHEPERD_CONFIG` | `~/.config/sheperd/host.json` | Config file |
| `HERDR_SESSION` / `HERDR_SOCKET_PATH` | default session | Target another herdr session |
| `HERDR_BIN` | `herdr` | herdr binary |

## Security model

- Each paired phone has its own random 256-bit token. The host stores only a hash of it. Pairing codes work once and expire after 10 minutes.
- Phones authenticate in the first message on the connection, so the check is the same directly and through the relay. `devices revoke` takes effect immediately, including at the relay.
- The host forwards only a fixed allowlist of herdr methods: listing, reading, prompting, sending keys, renaming and focusing agents. See `FORWARDED_METHODS` in `packages/protocol/src/wire.ts`.
- Starting agents goes through a narrow host method rather than raw herdr calls. It only accepts an agent type herdr supports that is installed on the computer, and only in the directory of an existing herdr workspace.
- A leaked device token can't run arbitrary shell commands through the API, but it *can* type into your agents and terminals. If a phone is lost, revoke it.
- Upgrading from an earlier version: the old shared token becomes a device called `legacy`, so already-connected phones keep working until you revoke it.
- **End-to-end encryption on every connection** (LAN, Tailscale and relay):
  - **Identity:** the host has a long-term X25519 key. The pairing QR code carries its public half, and the phone pins it, so a relay or anyone on the network can't impersonate your computer.
  - **Handshake:** each connection runs a Noise NK-style handshake. Throwaway keys on both sides give forward secrecy, and a second exchange with the host's long-term key proves it's really your computer.
  - **Messages:** every message after that is ChaCha20-Poly1305 with a counter nonce, so tampering, replays and reordering are detected.
  - **Implementation:** the crypto uses the audited [@noble](https://paulmillr.com/noble/) libraries. See `packages/protocol/src/secure.ts`.
- **Login stays inside the tunnel:** the phone's token only travels inside the encrypted channel. The relay's admission check gets `sha256(token)` instead, which can't be used to log in.
- **Pinning older phones:** phones paired before encryption existed pin the host key the first time they connect (trust on first use). Re-pair them if you want the key to come from the QR code.

## Development

```bash
npm run typecheck   # all workspaces
npm test            # protocol, host, app client and relay end-to-end tests
npm run lint        # app lint
npm run dev -w @sheperd/host   # host with auto-reload
npm run relay                  # relay locally (copy apps/relay/.dev.vars.example to apps/relay/.dev.vars)
```

```
apps/
  host/src/
    cli.ts            entry point and commands
    herdr/            herdr socket client, agent tracker, terminal streams, agent launcher
    connection/       WebSocket server, encrypted session, relay tunnel
    pairing/          paired devices, pairing codes, QR output
    notifications/    ntfy notifier
    system/           config file, launchd/systemd service
    testing/          fake herdr and test clients
  mobile/src/
    app/              screens (Expo Router)
    connection/       host client (address racing, encryption), saved settings, pairing
    agents/           agent list helpers, blocked-prompt parsing and answer cards
    terminal/         xterm.js WebView (the page is generated on npm install)
    ui/               theme
  relay/src/          Cloudflare Worker + one HostRoom Durable Object per host
packages/
  protocol/src/       shared types: herdr API subset, app↔host messages, relay tunnel,
                      pairing links, end-to-end encryption
```

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
9. [x] Per-device tokens, one-time pairing codes and revocation
10. [x] End-to-end encryption between phone and host, so the relay sees only ciphertext
11. [x] Run the host in the background (launchd / systemd units)
