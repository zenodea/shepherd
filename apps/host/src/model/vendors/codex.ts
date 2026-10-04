// Codex: /model lists models, then asks for a reasoning level for the one
// picked; "(current)" marks what's in use, and "s" keeps it to this session.
import type { ModelChoice } from "@shepherd/protocol";
import type { ModelMenu, ModelVendor } from "../models.ts";
import { ScreenError, menuRows, type MenuRow, type PaneScreen } from "../screen.ts";

const PROMPT = "›";
const MODELS = /Select Model and Effort/;
const EFFORT = /Select Reasoning Level/;

const choice = (r: MenuRow): ModelChoice => ({ label: r.label, ...(r.detail ? { detail: r.detail } : {}) });
/** "More reasoning…" opens another menu; not a level itself. */
const isLevel = (r: MenuRow) => !r.label.endsWith("…");
const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The footer, e.g. "GPT-6-Astra high · ~/project": the model and effort in use. */
export function footer(text: string, models: ModelChoice[], efforts: ModelChoice[]): { model: string | null; effort: string | null } {
  const byLength = [...models].sort((a, b) => b.label.length - a.label.length);
  for (const line of text.split("\n").reverse()) {
    const trimmed = line.trim();
    const model = byLength.find((m) => trimmed.startsWith(`${m.label} `) && trimmed.includes(" · "));
    if (!model) continue;
    const said = trimmed.slice(model.label.length, trimmed.indexOf(" · ")).trim();
    return { model: model.label, effort: efforts.find((e) => same(e.label, said) || (same(said, "xhigh") && same(e.label, "extra high")))?.label ?? null };
  }
  return { model: null, effort: null };
}

/** With the model menu open: picks the model numbered `number` and returns the reasoning menu's levels, or null when it has none. */
async function enterModel(screen: PaneScreen, number: number): Promise<MenuRow[] | null> {
  await screen.moveTo(MODELS, number);
  await screen.keys("enter");
  const text = await screen.until((t) => EFFORT.test(t) || !MODELS.test(t), "Codex didn't take the model.");
  return EFFORT.test(text) ? menuRows(text, EFFORT).filter(isLevel) : null;
}

export const codexModels: ModelVendor = {
  id: "codex",

  async read(screen) {
    await screen.command("/model", PROMPT, MODELS);
    try {
      const rows = await screen.allRows(MODELS);
      const current = rows.find((r) => r.current);
      if (!rows.length || !current) throw new ScreenError("Couldn't read Codex's models.");
      const levels = (await enterModel(screen, current.number)) ?? [];
      return {
        models: rows.map(choice),
        model: current.label,
        efforts: levels.map(choice),
        effort: levels.find((r) => r.current)?.label ?? null,
      } satisfies ModelMenu;
    } finally {
      await screen.close(EFFORT);
      await screen.close(MODELS);
    }
  },

  glance(text, _transcriptModel, menu) {
    return footer(text, menu.models, menu.efforts);
  },

  async choose(screen, change, menu) {
    await screen.command("/model", PROMPT, MODELS);
    try {
      const rows = await screen.allRows(MODELS);
      const wanted = change.model ?? menu.model;
      const target = rows.find((r) => r.label === wanted) ?? rows.find((r) => r.current);
      if (!target) throw new ScreenError(`Codex no longer offers ${wanted}.`);
      const levels = await enterModel(screen, target.number);
      if (!levels) return { ...menu, model: target.label, efforts: [], effort: null };
      // A level this model doesn't have: keep what it had, else its default.
      const level = levels.find((r) => r.label === (change.effort ?? menu.effort)) ?? levels.find((r) => r.current) ?? levels.find((r) => r.isDefault) ?? levels[0]!;
      await screen.moveTo(EFFORT, level.number);
      await screen.keys("s");
      await screen.until((t) => !EFFORT.test(t) && !MODELS.test(t), "Codex didn't take the reasoning level.");
      return { ...menu, model: target.label, efforts: levels.map(choice), effort: level.label };
    } finally {
      await screen.close(EFFORT);
      await screen.close(MODELS);
    }
  },
};
