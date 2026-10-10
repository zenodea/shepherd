# herdr plugins on the phone

Every herdr plugin shows up in Shepherd without anyone doing anything: install it with `herdr plugin install`, and the next time the phone looks, it's there. On the phone, open an agent's menu (⋯), choose **Plugins** and tap the plugin; its page shows what it has for that agent. Settings → Plugins lists the same plugins for what's about the computer rather than an agent.

What a plugin shows depends on what its author did:

- **Nothing special:** the plugin's page shows its herdr actions (from its `herdr-plugin.toml`) as buttons, with their descriptions when they have any, its panes as buttons that open them live on the phone, where it came from, and its recent runs from herdr's plugin log. Tapping one invokes the action through herdr, with the agent you're looking at as the context, exactly as if you'd run it from herdr's palette on that pane. Actions whose only context is `selection` are left out, since the phone has no selected text to give them.
- **A `shepherd.toml`:** the plugin's page also shows **cards**. A card is a small panel the host fills by running a command of the plugin's, which prints JSON. This file is the whole contract, and it's described below.

To keep a plugin off phones, open the Shepherd window in herdr (`herdr plugin action invoke shepherd.open`), press `i` for Plugins, select it and press space. The window also shows, for each plugin, which commands its cards run.

## `shepherd.toml`

Put it next to `herdr-plugin.toml`, in the plugin's root.

```toml
schema = 1

[[cards]]
id = "pen"
title = "Pen"
context = "pane"                     # pane (default), workspace or global
command = ["node", "src/cli.ts", "shepherd-card"]
refresh = "status"                   # default; or a number of seconds
timeout = 10                         # seconds; default 10, at most 60

[[cards]]
id = "pens"
title = "Pens"
context = "global"
command = ["node", "src/cli.ts", "shepherd-pens"]
refresh = 60
```

| Key | Meaning |
| --- | --- |
| `schema` | The version of this contract the file is written for. Only `1` exists. A file for a newer schema than the host knows is shown as an error on the Plugins screen, not guessed at. |
| `actions` | `false` hides the card made from the plugin's herdr actions. Default `true`. |
| `cards[].id` | Unique within the plugin. Letters, digits, `_`, `-`, `.`. |
| `cards[].title` | Shown on the card, under the plugin's name. |
| `cards[].context` | `pane`: one card per agent, shown on that agent's Plugins screen. `workspace`: one per herdr workspace, run once for every agent in it. `global`: one for the computer, shown on every Plugins screen and in Settings. |
| `cards[].command` | Run from the plugin's root, with the variables below. Must print one JSON object. |
| `cards[].refresh` | When to run the command again. `"status"` (default): when the agent's status has changed since the last run. A number: after that many seconds. Either way at most every 5 seconds, and always after 10 minutes or when you pull to refresh. |
| `cards[].timeout` | How long the command may take. A card whose command is too slow shows that instead. |

### What the command gets

The same variables herdr gives plugin actions, so the command can reuse the plugin's own code:

| Variable | Value |
| --- | --- |
| `HERDR_PLUGIN_ID`, `HERDR_PLUGIN_ROOT` | The plugin's id and folder. |
| `HERDR_PLUGIN_CONFIG_DIR`, `HERDR_PLUGIN_STATE_DIR` | herdr's config and state folders for this plugin. |
| `HERDR_BIN_PATH`, `HERDR_SOCKET_PATH`, `HERDR_SESSION` | How to reach herdr. |
| `HERDR_PANE_ID`, `HERDR_WORKSPACE_ID` | The agent the card is for and its workspace. Not set for `global` cards. |
| `HERDR_ACTIVE_PANE_ID`, `HERDR_ACTIVE_WORKSPACE_ID`, `HERDR_ACTIVE_PANE_CWD` | The same, as herdr names them for actions, plus the agent's folder. |
| `HERDR_PLUGIN_CONTEXT_JSON` | herdr's invocation context: `focused_pane_id`, `workspace_id`, `focused_pane_agent`, `focused_pane_status`, `focused_pane_cwd`, `workspace_cwd`, with `invocation_source` set to `"shepherd"`. |
| `SHEPHERD_CARD`, `SHEPHERD_CONTEXT` | Which card is being asked for, and its context, so one command can serve several cards. |

### What the command prints

One JSON object:

```json
{
  "rows": [
    { "kind": "badge", "text": "penned", "tone": "ok" },
    { "kind": "text", "label": "Profile", "value": "strict: no ~/.ssh, no network" },
    { "kind": "list", "items": [{ "text": "api", "detail": "2 agents inside" }, "web"] }
  ],
  "buttons": [
    { "label": "Open fence", "pane": "window" },
    { "label": "Unpen", "action": "unpen", "confirm": "Agents here get your secrets and the network back.", "tone": "bad" }
  ]
}
```

Rows, in order, from this vocabulary:

| Row | Fields |
| --- | --- |
| `text` | `value`; optional `label` shown dim above it. |
| `badge` | `text`; `tone`: `neutral` (default), `ok`, `warn` or `bad`. |
| `list` | `items`: strings, or objects with `text` and an optional `detail` line. |

A row of a kind the phone doesn't know is skipped, so a card written for a future schema still shows what it can. Up to 40 rows, 8 buttons and 50 list items; longer text is cut.

Buttons name something from the plugin's `herdr-plugin.toml`, and nothing else:

- `action`: the id of one of its `[[actions]]`. Invoked through herdr with the agent as context; herdr logs it like any other action. When it finishes, the phone shows what it printed. Then the plugin's cards are run again.
- `pane`: the id of one of its `[[panes]]`. herdr opens it as a tab in the agent's workspace, without taking focus, and the phone shows it live, with the keyboard.
- `confirm`: asked before doing it. `tone: "bad"` makes it a red, destructive button.

Print `{ "hide": true }` when the card has nothing to say for this agent, and it isn't shown.

### When things go wrong

A command that fails, times out, prints something that isn't JSON, or prints JSON that doesn't fit shows the reason on its card, in place of its content, with the plugin's stderr. Nothing else on the screen is affected. A `shepherd.toml` that doesn't parse is reported on the Plugins screen in the Shepherd window and in the app's Settings, and the plugin still shows its actions.

### Trying it

Link your plugin into herdr while you work on it:

```bash
herdr plugin link /path/to/your-plugin
```

The host reads `shepherd.toml` fresh each time the phone asks, so edits show up on the next pull to refresh. Card commands run with the host's environment; their output and errors appear on the card. `herdr plugin log` shows the actions the phone invoked.
