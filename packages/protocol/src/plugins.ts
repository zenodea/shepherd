// herdr plugins on the phone; the contract is in docs/plugins.md.

export const PLUGIN_SCHEMA = 1;

export const CARD_CONTEXTS = ["pane", "workspace", "global"] as const;
export type CardContext = (typeof CARD_CONTEXTS)[number];

export const TONES = ["neutral", "ok", "warn", "bad"] as const;
export type Tone = (typeof TONES)[number];

export type CardRow =
  | { kind: "text"; label?: string; value: string }
  | { kind: "badge"; text: string; tone: Tone }
  | { kind: "list"; items: { text: string; detail?: string }[] };

/** Exactly one of `action` (a herdr action id) or `pane` (a pane entrypoint id). */
export type CardButton = { label: string; action?: string; pane?: string; confirm?: string; tone?: Tone };

export type CardBody = { rows: CardRow[]; buttons: CardButton[] };

export type Card = {
  plugin: string;
  pluginName: string;
  /** "actions" for the card made from the plugin's herdr actions. */
  id: string;
  title: string;
  context: CardContext;
  updatedAt: number;
} & ({ body: CardBody } | { error: string });

export type ActionContext = "global" | "workspace" | "tab" | "pane" | "selection";

export type PluginAction = { id: string; title: string; description: string | null; contexts: ActionContext[] };
export type PluginPaneEntry = { id: string; title: string; description: string | null };
export type CardSpec = { id: string; title: string; context: CardContext };

export type PluginSummary = {
  id: string;
  name: string;
  version: string;
  description: string | null;
  actions: PluginAction[];
  panes: PluginPaneEntry[];
  cards: CardSpec[];
  sidecarError?: string;
};

export type PluginsResult = { plugins: PluginSummary[] };

/** Without `paneId`, only the computer's cards. */
export type CardsParams = { paneId?: string; refresh?: boolean };
export type CardsResult = { cards: Card[] };

export type PluginActionParams = { plugin: string; action: string; paneId?: string };
export type PluginActionResult = { status: "succeeded" | "failed" | "running"; output: string | null; error: string | null };

export type PluginPaneParams = { plugin: string; pane: string; paneId?: string };
export type PluginPaneResult = { paneId: string; workspaceId: string };

const MAX_ROWS = 40;
const MAX_BUTTONS = 8;
const MAX_ITEMS = 50;
const MAX_TEXT = 2000;
const MAX_LABEL = 120;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export const isPluginId = (value: unknown): value is string => typeof value === "string" && ID.test(value);

const text = (value: unknown, max = MAX_TEXT): string | null =>
  typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b-\u001f]/g, "").slice(0, max) : null;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const tone = (value: unknown): Tone => ((TONES as readonly string[]).includes(value as string) ? (value as Tone) : "neutral");

export class CardFormatError extends Error {}

/** Unknown row kinds are dropped, so a newer sidecar still renders on an older phone. */
export function parseCardBody(raw: unknown): CardBody | "hide" {
  if (!isRecord(raw)) throw new CardFormatError("The card command must print a JSON object.");
  if (raw.hide === true) return "hide";
  const rows: CardRow[] = [];
  if (raw.rows !== undefined) {
    if (!Array.isArray(raw.rows)) throw new CardFormatError('"rows" must be an array.');
    for (const [i, row] of raw.rows.slice(0, MAX_ROWS).entries()) {
      if (!isRecord(row)) throw new CardFormatError(`rows[${i}] must be an object.`);
      switch (row.kind) {
        case "text": {
          const value = text(row.value);
          if (value === null) throw new CardFormatError(`rows[${i}]: a text row needs a "value" string.`);
          const label = text(row.label, MAX_LABEL);
          rows.push(label ? { kind: "text", label, value } : { kind: "text", value });
          break;
        }
        case "badge": {
          const value = text(row.text, MAX_LABEL);
          if (value === null) throw new CardFormatError(`rows[${i}]: a badge needs a "text" string.`);
          rows.push({ kind: "badge", text: value, tone: tone(row.tone) });
          break;
        }
        case "list": {
          if (!Array.isArray(row.items)) throw new CardFormatError(`rows[${i}]: a list needs "items".`);
          const items = row.items.slice(0, MAX_ITEMS).flatMap((item) => {
            const t = isRecord(item) ? text(item.text) : text(item);
            if (t === null) return [];
            const detail = isRecord(item) ? text(item.detail) : null;
            return [detail ? { text: t, detail } : { text: t }];
          });
          rows.push({ kind: "list", items });
          break;
        }
        default:
          if (typeof row.kind !== "string") throw new CardFormatError(`rows[${i}] needs a "kind".`);
      }
    }
  }
  const buttons: CardButton[] = [];
  if (raw.buttons !== undefined) {
    if (!Array.isArray(raw.buttons)) throw new CardFormatError('"buttons" must be an array.');
    for (const [i, b] of raw.buttons.slice(0, MAX_BUTTONS).entries()) {
      if (!isRecord(b)) throw new CardFormatError(`buttons[${i}] must be an object.`);
      const label = text(b.label, MAX_LABEL);
      if (!label) throw new CardFormatError(`buttons[${i}] needs a "label".`);
      const hasAction = isPluginId(b.action);
      const hasPane = isPluginId(b.pane);
      if (hasAction === hasPane) throw new CardFormatError(`buttons[${i}] needs exactly one of "action" or "pane" (an id from herdr-plugin.toml).`);
      const button: CardButton = { label, ...(hasAction ? { action: b.action as string } : { pane: b.pane as string }) };
      const confirm = text(b.confirm, MAX_TEXT);
      if (confirm) button.confirm = confirm;
      if (b.tone !== undefined) button.tone = tone(b.tone);
      buttons.push(button);
    }
  }
  return { rows, buttons };
}
