import { parse } from "smol-toml";
import { CARD_CONTEXTS, PLUGIN_SCHEMA, isPluginId, type CardContext } from "@shepherd/protocol";

export const SIDECAR_FILE = "shepherd.toml";

export type SidecarCard = {
  id: string;
  title: string;
  context: CardContext;
  command: string[];
  refresh: "status" | number;
  timeoutMs: number;
};

export type Sidecar = { schema: number; actions: boolean; cards: SidecarCard[] };

const MAX_CARDS = 12;
const DEFAULT_TIMEOUT_S = 10;
const MAX_TIMEOUT_S = 60;
const MIN_REFRESH_S = 5;

export class SidecarError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseSidecar(text: string): Sidecar {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    throw new SidecarError(`${SIDECAR_FILE} isn't valid TOML: ${(err as Error).message.split("\n")[0]}`);
  }
  if (!isRecord(raw)) throw new SidecarError(`${SIDECAR_FILE} must be a table.`);
  const schema = raw.schema ?? PLUGIN_SCHEMA;
  if (typeof schema !== "number" || !Number.isInteger(schema) || schema < 1) throw new SidecarError('"schema" must be a whole number.');
  if (schema > PLUGIN_SCHEMA) throw new SidecarError(`${SIDECAR_FILE} is written for a newer Shepherd (schema ${schema}). Update Shepherd on this computer.`);
  if (raw.actions !== undefined && typeof raw.actions !== "boolean") throw new SidecarError('"actions" must be true or false.');
  const cards: SidecarCard[] = [];
  if (raw.cards !== undefined) {
    if (!Array.isArray(raw.cards)) throw new SidecarError('"cards" must be an array of tables ([[cards]]).');
    if (raw.cards.length > MAX_CARDS) throw new SidecarError(`At most ${MAX_CARDS} cards.`);
    for (const [i, card] of raw.cards.entries()) {
      const where = `cards[${i}]`;
      if (!isRecord(card)) throw new SidecarError(`${where} must be a table.`);
      if (!isPluginId(card.id)) throw new SidecarError(`${where} needs an "id": letters, digits, "_", "-" or ".".`);
      if (cards.some((c) => c.id === card.id)) throw new SidecarError(`${where}: another card already has the id "${card.id}".`);
      if (typeof card.title !== "string" || !card.title.trim()) throw new SidecarError(`${where} ("${card.id}") needs a "title".`);
      const context = card.context ?? "pane";
      if (!(CARD_CONTEXTS as readonly unknown[]).includes(context)) throw new SidecarError(`${where} ("${card.id}"): "context" must be one of ${CARD_CONTEXTS.join(", ")}.`);
      if (!Array.isArray(card.command) || card.command.length === 0 || !card.command.every((c) => typeof c === "string" && c.length > 0)) {
        throw new SidecarError(`${where} ("${card.id}") needs a "command": an array of strings, e.g. ["node", "src/cli.ts", "card"].`);
      }
      let refresh: SidecarCard["refresh"] = "status";
      if (card.refresh !== undefined && card.refresh !== "status") {
        if (typeof card.refresh !== "number" || !(card.refresh > 0)) throw new SidecarError(`${where} ("${card.id}"): "refresh" is "status" or a number of seconds.`);
        refresh = Math.max(MIN_REFRESH_S, card.refresh);
      }
      let timeoutS = DEFAULT_TIMEOUT_S;
      if (card.timeout !== undefined) {
        if (typeof card.timeout !== "number" || !(card.timeout > 0)) throw new SidecarError(`${where} ("${card.id}"): "timeout" is a number of seconds.`);
        timeoutS = Math.min(MAX_TIMEOUT_S, card.timeout);
      }
      cards.push({ id: card.id, title: card.title.trim(), context: context as CardContext, command: card.command, refresh, timeoutMs: timeoutS * 1000 });
    }
  }
  return { schema, actions: raw.actions !== false, cards };
}
