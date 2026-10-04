import type { HerdrClient } from "../herdr/herdr-client.ts";

const POLL_MS = 120;
const WAIT_MS = 4000;
/** Long enough for an agent to react to Enter. */
const SETTLE_MS = 500;

export class ScreenError extends Error {}

/** A row of a numbered terminal menu, e.g. "❯ 2. Opus 5.5 ✔   For complex work". */
export type MenuRow = { number: number; label: string; detail: string; cursor: boolean; current: boolean; isDefault: boolean };

const ROW = /^\s*((?:[❯›>↑↓]\s*)*)(\d+)\.\s+(.*)$/;
const CURRENT = /✔|\(current\)/;
const DEFAULT = /\(default\)/;
const MARKERS = /\s*(?:✔|\((?:current|default|recommended)\))\s*/g;

/** The numbered rows below the last line matching `title`. */
export function menuRows(text: string, title: RegExp): MenuRow[] {
  const lines = text.split("\n");
  const start = lines.findLastIndex((l) => title.test(l));
  if (start === -1) return [];
  return lines.slice(start + 1).flatMap((line) => {
    const match = ROW.exec(line);
    if (!match) return [];
    const [name = "", ...rest] = match[3]!.trim().split(/\s{2,}/);
    return [
      {
        number: Number(match[2]),
        label: name.replace(MARKERS, " ").trim(),
        detail: rest.join(" ").trim(),
        cursor: /[❯›>]/.test(match[1]!),
        current: CURRENT.test(name),
        isDefault: DEFAULT.test(name),
      },
    ];
  });
}

/** One pane's screen through herdr: read it, press keys, wait for it to change. */
export class PaneScreen {
  private readonly herdr: HerdrClient;
  readonly paneId: string;

  constructor(herdr: HerdrClient, paneId: string) {
    this.herdr = herdr;
    this.paneId = paneId;
  }

  async read(): Promise<string> {
    const { read } = await this.herdr.request<{ read: { text: string } }>("pane.read", { pane_id: this.paneId, source: "visible", format: "text" });
    return read.text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
  }

  async keys(...keys: string[]): Promise<void> {
    if (keys.length) await this.herdr.request("pane.send_keys", { pane_id: this.paneId, keys });
  }

  async type(text: string): Promise<void> {
    await this.herdr.request("pane.send_input", { pane_id: this.paneId, text });
  }

  /** The screen once `ready` holds for it; fails with `what` after a few seconds. */
  async until(ready: (text: string) => boolean, what: string): Promise<string> {
    const end = Date.now() + WAIT_MS;
    for (;;) {
      const text = await this.read();
      if (ready(text)) return text;
      if (Date.now() > end) throw new ScreenError(what);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  /** Types a command into the agent's empty prompt (its last line starting with `mark`); a draft there is left as it was. */
  private async typeCommand(command: string, mark: string): Promise<(text: string) => string | undefined> {
    const prompt = (text: string) => text.split("\n").findLast((l) => l.trimStart().startsWith(mark))?.trim();
    await this.type(command);
    try {
      await this.until((t) => prompt(t) === `${mark} ${command}`, "There's something typed in the agent's prompt. Clear it first.");
    } catch (err) {
      await this.keys(...Array<string>(command.length).fill("backspace"));
      throw err;
    }
    return prompt;
  }

  /** Types a slash command and opens the menu titled `title` it shows. */
  async command(command: string, mark: string, title: RegExp): Promise<string> {
    await this.typeCommand(command, mark);
    await this.keys("enter");
    return this.until((t) => title.test(t), `The agent didn't open ${command}.`);
  }

  /**
   * Types a command and sends it. When Enter only takes an autocomplete
   * suggestion, it's sent once the suggestion turns out to be exactly the
   * command; anything else is cleared rather than sent.
   */
  async say(command: string, mark: string): Promise<void> {
    const prompt = await this.typeCommand(command, mark);
    await this.keys("enter");
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const left = prompt(await this.read());
    if (left === `${mark} ${command}`) await this.keys("enter");
    else if (left && left !== mark) {
      await this.keys(...Array<string>(left.length).fill("backspace"));
      throw new ScreenError(`The agent changed ${command} into something else, so it wasn't sent.`);
    }
    await this.until((t) => prompt(t) === mark, `The agent didn't take ${command}.`);
  }

  /** Closes the menu titled `title`. */
  async close(title: RegExp): Promise<void> {
    if (!title.test(await this.read())) return;
    await this.keys("esc");
    await this.until((t) => !title.test(t), "The agent's menu didn't close.");
  }

  /** Moves a menu's cursor to the row numbered `target`. */
  async moveTo(title: RegExp, target: number): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const rows = menuRows(await this.read(), title);
      const at = rows.find((r) => r.cursor)?.number;
      if (at === undefined) throw new ScreenError("Lost track of the agent's menu.");
      if (at === target) return;
      const steps = target - at;
      await this.keys(...Array<string>(Math.abs(steps)).fill(steps > 0 ? "down" : "up"));
      await this.until((t) => menuRows(t, title).find((r) => r.cursor)?.number !== at, "The agent's menu didn't move.");
    }
    throw new ScreenError("Couldn't reach that choice in the agent's menu.");
  }

  /** Every row of a menu that scrolls, collected by moving down through it. */
  async allRows(title: RegExp): Promise<MenuRow[]> {
    const seen = new Map<number, MenuRow>();
    const menu = (text: string) => text.split("\n").slice(text.split("\n").findLastIndex((l) => title.test(l))).join("\n");
    let text = await this.read();
    for (let page = 0; page < 8; page++) {
      const rows = menuRows(text, title);
      for (const row of rows) if (!seen.has(row.number)) seen.set(row.number, row);
      const at = rows.find((r) => r.cursor)?.number;
      // "↓ 10." or "… +2 models": there's more below.
      if (!/↓|…\s*\+\d+/.test(menu(text)) || at === undefined) break;
      await this.keys(...Array<string>(rows.length).fill("down"));
      text = await this.until((t) => menuRows(t, title).find((r) => r.cursor)?.number !== at, "The agent's menu didn't scroll.");
    }
    // Moved down to see the rest: the cursor isn't where it was.
    return [...seen.values()].sort((a, b) => a.number - b.number).map((r) => ({ ...r, cursor: false }));
  }
}
