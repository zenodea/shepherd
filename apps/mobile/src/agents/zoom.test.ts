import { describe, expect, it } from "vitest";
import { IDENTITY, clampView, fitted, pinch, toggleZoom } from "./zoom";

const size = { width: 400, height: 800 };
const shown = (v: { scale: number; x: number; y: number }, p: { x: number; y: number }) => ({ x: v.x + v.scale * p.x, y: v.y + v.scale * p.y });

describe("image zoom", () => {
  it("keeps the pinched spot under the fingers", () => {
    const from = { focal: { x: 100, y: -50 }, distance: 100 };
    const to = { focal: { x: 120, y: -40 }, distance: 300 };
    const view = pinch(IDENTITY, from, to);
    expect(view.scale).toBe(3);
    // The image point that was under the fingers is still under them.
    expect(shown(view, { x: 100, y: -50 })).toEqual(to.focal);
  });

  it("doesn't zoom out past fit or pan off the image", () => {
    expect(clampView({ scale: 0.5, x: 30, y: 30 }, size)).toEqual(IDENTITY);
    expect(clampView({ scale: 2, x: 999, y: -999 }, size)).toEqual({ scale: 2, x: 200, y: -400 });
  });

  it("stops at a wide picture's own edges, not the screen's", () => {
    // A 1600×1000 screenshot on a 400×800 screen shows 400×250.
    const picture = fitted({ width: 1600, height: 1000 }, size);
    expect(picture).toEqual({ width: 400, height: 250 });
    // At 2× it's 800×500: 200 to pan each way sideways, none up or down (it's still shorter than the screen).
    expect(clampView({ scale: 2, x: 999, y: 999 }, size, picture)).toEqual({ scale: 2, x: 200, y: 0 });
    // At 4× it's 1000 tall: 100 up or down.
    expect(clampView({ scale: 4, x: 0, y: -999 }, size, picture).y).toBe(-100);
  });

  it("double tap zooms in on the spot, then back out", () => {
    const zoomed = toggleZoom(IDENTITY, { x: 50, y: 100 }, size);
    expect(zoomed.scale).toBe(2.5);
    expect(shown(zoomed, { x: 50, y: 100 })).toEqual({ x: 50, y: 100 });
    expect(toggleZoom(zoomed, { x: 0, y: 0 }, size)).toEqual(IDENTITY);
  });
});
