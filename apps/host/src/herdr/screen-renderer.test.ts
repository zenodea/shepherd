import { describe, expect, it } from "vitest";
import { SPAN_BOLD } from "@shepherd/protocol";
import { ScreenRenderer, type ScreenUpdate } from "./screen-renderer.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const nextUpdate = (updates: ScreenUpdate[], n: number) =>
  new Promise<ScreenUpdate>((resolve, reject) => {
    const start = Date.now();
    const tick = () => (updates.length >= n ? resolve(updates[n - 1]!) : Date.now() - start > 2000 ? reject(new Error("no update")) : setTimeout(tick, 10));
    tick();
  });

describe("ScreenRenderer", () => {
  it("sends the whole screen first, as styled spans", async () => {
    const updates: ScreenUpdate[] = [];
    const r = new ScreenRenderer(20, 3, (u) => updates.push(u));
    r.write(enc("\u001b[2J\u001b[H\u001b[1;32mok\u001b[0m done\r\nsecond"));
    const u = await nextUpdate(updates, 1);
    expect(u.full).toBe(true);
    expect(u.lines).toEqual({
      0: [
        ["ok", "#4ADE80", null, SPAN_BOLD],
        [" done", null, null, 0],
      ],
      1: [["second", null, null, 0]],
      2: [],
    });
    expect(u.cursor).toMatchObject({ x: 6, y: 1 });
    r.dispose();
  });

  it("then only the rows that changed", async () => {
    const updates: ScreenUpdate[] = [];
    const r = new ScreenRenderer(20, 3, (u) => updates.push(u));
    r.write(enc("one\r\ntwo\r\nthree"));
    await nextUpdate(updates, 1);
    r.write(enc("\u001b[2;1H\u001b[2KTWO"));
    const u = await nextUpdate(updates, 2);
    expect(u.full).toBe(false);
    expect(u.lines).toEqual({ 1: [["TWO", null, null, 0]] });
    r.dispose();
  });

  it("follows frame size changes with a full update", async () => {
    const updates: ScreenUpdate[] = [];
    const r = new ScreenRenderer(20, 3, (u) => updates.push(u));
    r.write(enc("a"));
    await nextUpdate(updates, 1);
    r.write(enc("b"), { width: 30, height: 5 });
    const u = await nextUpdate(updates, 2);
    expect(u).toMatchObject({ full: true, width: 30, height: 5 });
    expect(Object.keys(u.lines)).toHaveLength(5);
    r.dispose();
  });

  it("keeps background-coloured padding but trims plain trailing spaces", async () => {
    const updates: ScreenUpdate[] = [];
    const r = new ScreenRenderer(10, 1, (u) => updates.push(u));
    r.write(enc("\u001b[44mhi  \u001b[0m   "));
    const u = await nextUpdate(updates, 1);
    expect(u.lines[0]).toEqual([["hi  ", null, "#60A5FA", 0]]);
    r.dispose();
  });
});
