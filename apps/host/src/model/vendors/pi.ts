// Pi: `pi --list-models` lists every configured provider's models without
// touching a session, and `/model <provider>/<id>` and `/thinking <level>`
// switch this session only.
import { execFile } from "node:child_process";
import { choiceId, type ModelChoice } from "@shepherd/protocol";
import { ModelError, sameModel, type ModelMenu, type ModelVendor } from "../models.ts";
import type { PaneScreen } from "../screen.ts";

const PROMPT = ">";
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];
const LIST_TIMEOUT_MS = 20_000;

/** `pi --list-models`: a table of provider, model, context, max-out, thinking, images. */
export function parseModelList(out: string): ModelChoice[] {
  const [header, ...rows] = out.split("\n").filter((l) => l.trim());
  if (!header || !/^provider\s+model\b/.test(header.trim())) return [];
  return rows.flatMap((row) => {
    const [provider, id, context, , thinking, images] = row.trim().split(/\s+/);
    if (!provider || !id) return [];
    return [
      {
        id: `${provider}/${id}`,
        label: id,
        group: provider,
        detail: [context && `${context} context`, images === "yes" && "images"].filter(Boolean).join(" · "),
        ...(thinking === "no" ? { noEffort: true } : {}),
      },
    ];
  });
}

/**
 * The model and thinking level in the footer: Pi's own "(anthropic) claude-sonnet-5 • high"
 * (or "… • thinking off"), or the powerline extension's "Sonnet 5  think:high".
 */
export function footer(text: string, models: ModelChoice[], known: string | null): { model: string | null; effort: string | null } {
  // Powerline footers put Nerd Font icons (private-use characters) between their parts.
  const lines = text.replace(/[\uE000-\uF8FF]|[\u{F0000}-\u{FFFFD}]/gu, "").split("\n").reverse();
  const pick = (matches: ModelChoice[]) => (matches.find((m) => choiceId(m) === known) ?? matches[0]) ?? null;
  for (const line of lines) {
    const own = /(?:\((\S+)\) )?(\S+) • (?:thinking (off)|(\w+))\s*$/.exec(line);
    if (own) {
      const [, provider, id, off, level] = own;
      const model = pick(models.filter((m) => m.label === id && (!provider || m.group === provider)));
      return { model: model ? choiceId(model) : null, effort: off ?? level ?? null };
    }
    const powerline = /^\s*(.+?)\s{2,}think:(\w+)/.exec(line);
    if (powerline) {
      const model = pick(models.filter((m) => sameModel(m.label, powerline[1]!)));
      return { model: model ? choiceId(model) : null, effort: powerline[2]! };
    }
  }
  return { model: null, effort: null };
}

const listModels = () =>
  new Promise<ModelChoice[]>((resolve, reject) => {
    execFile("pi", ["--list-models"], { timeout: LIST_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      const models = parseModelList(stdout ?? "");
      if (models.length) resolve(models);
      else reject(new ModelError(err ? `Couldn't list Pi's models: ${err.message}` : "Pi listed no models. Log in to a provider with /login first."));
    });
  });

export const piModels: ModelVendor = {
  id: "pi",
  quiet: true,

  async read(screen) {
    const models = await listModels();
    const now = footer(await screen.read(), models, null);
    return { models, model: now.model, efforts: LEVELS.map((label) => ({ label })), effort: now.effort } satisfies ModelMenu;
  },

  glance(text, _transcriptModel, menu) {
    return footer(text, menu.models, menu.model);
  },

  async choose(screen, change, menu) {
    let model = menu.model;
    if (change.model) {
      await screen.say(`/model ${change.model}`, PROMPT);
      await screen.until((t) => footer(t, menu.models, change.model!).model === change.model, "Pi didn't show the new model.").catch(() => "");
      model = change.model;
    }
    if (change.effort) {
      await screen.say(`/thinking ${change.effort}`, PROMPT);
      await screen.until((t) => footer(t, menu.models, model).effort === change.effort, "Pi didn't show the new thinking level.").catch(() => "");
    }
    // Pi picks a thinking level of its own for a new model: show what it chose.
    const now = footer(await screen.read(), menu.models, model);
    return { ...menu, model: now.model ?? model, effort: now.effort ?? change.effort ?? menu.effort };
  },
};
