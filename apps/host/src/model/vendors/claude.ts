// Claude Code: /model lists models (✔ marks the one in use) and /effort is a
// slider. In both, "s" applies the choice to this session only.
import { sameModel, type ModelMenu, type ModelVendor } from "../models.ts";
import { ScreenError, type PaneScreen } from "../screen.ts";

const PROMPT = "❯";
const MODELS = /Select model/;
const EFFORT = /Enter to confirm · s for this session only/;

/** The /effort slider: its levels, and which one the ▲ is under. */
export function effortSlider(text: string): { levels: string[]; at: number } | null {
  const lines = text.split("\n");
  const i = lines.findLastIndex((l) => l.includes("▲") && l.includes("─"));
  const below = lines[i + 1];
  if (i === -1 || below === undefined) return null;
  const line = lines[i]!;
  const mark = line.indexOf("▲");
  const start = line.search(/[─▲]/);
  const end = Math.max(line.lastIndexOf("─"), mark);
  const words = [...below.matchAll(/\S+/g)].filter((m) => m.index >= start - 2 && m.index <= end);
  if (!words.length) return null;
  const distance = (m: RegExpExecArray) => Math.abs(m.index + m[0].length / 2 - mark);
  const at = words.reduce((best, m, j) => (distance(m) < distance(words[best]!) ? j : best), 0);
  return { levels: words.map((m) => m[0]), at };
}

/** The effort shown in Claude Code's footer, e.g. "● high · /effort". */
export const footerEffort = (text: string) => /(\w+) · \/effort/.exec(text)?.[1] ?? null;

async function readModels(screen: PaneScreen): Promise<Pick<ModelMenu, "model" | "models">> {
  await screen.command("/model", PROMPT, MODELS);
  try {
    const rows = await screen.allRows(MODELS);
    if (!rows.length) throw new ScreenError("Couldn't read Claude Code's models.");
    return { models: rows.map((r) => ({ label: r.label, ...(r.detail ? { detail: r.detail } : {}) })), model: rows.find((r) => r.current)?.label ?? null };
  } finally {
    await screen.close(MODELS);
  }
}

async function readEffort(screen: PaneScreen): Promise<{ levels: string[]; at: number }> {
  const text = await screen.command("/effort", PROMPT, EFFORT);
  const slider = effortSlider(text);
  if (!slider) {
    await screen.close(EFFORT);
    throw new ScreenError("Couldn't read Claude Code's effort levels.");
  }
  return slider;
}

export const claudeModels: ModelVendor = {
  id: "claude",

  async read(screen) {
    const { models, model } = await readModels(screen);
    const slider = await readEffort(screen);
    await screen.close(EFFORT);
    return { models, model, efforts: slider.levels.map((label) => ({ label })), effort: slider.levels[slider.at] ?? null };
  },

  glance(text, transcriptModel, menu) {
    return {
      model: transcriptModel ? (menu.models.find((m) => sameModel(m.label, transcriptModel))?.label ?? null) : null,
      effort: menu.efforts.find((e) => e.label === footerEffort(text))?.label ?? null,
    };
  },

  async choose(screen, change, menu) {
    let { model, effort } = menu;
    if (change.model) {
      await screen.command("/model", PROMPT, MODELS);
      const rows = await screen.allRows(MODELS);
      const target = rows.find((r) => r.label === change.model);
      if (!target) {
        await screen.close(MODELS);
        throw new ScreenError(`Claude Code no longer offers ${change.model}.`);
      }
      await screen.moveTo(MODELS, target.number);
      await screen.keys("s");
      await screen.until((t) => !MODELS.test(t), "Claude Code didn't take the new model.");
      model = target.label;
    }
    if (change.effort) {
      const slider = await readEffort(screen);
      const target = slider.levels.indexOf(change.effort);
      if (target === -1) {
        await screen.close(EFFORT);
        throw new ScreenError(`Claude Code no longer offers ${change.effort} effort.`);
      }
      const steps = target - slider.at;
      await screen.keys(...Array<string>(Math.abs(steps)).fill(steps > 0 ? "right" : "left"));
      await screen.until((t) => effortSlider(t)?.at === target, "Claude Code's effort slider didn't move.");
      await screen.keys("s");
      await screen.until((t) => !EFFORT.test(t), "Claude Code didn't take the new effort.");
      effort = change.effort;
    }
    return { ...menu, model, effort };
  },
};
