// Zoom and pan for the full-screen image viewer. Points are relative to the
// centre of the screen; a point p of the image shows at (x + scale·p.x, y + scale·p.y).

export type ZoomView = { scale: number; x: number; y: number };
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 6;
export const DOUBLE_TAP_SCALE = 2.5;
export const IDENTITY: ZoomView = { scale: 1, x: 0, y: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How big the picture shows at fit: as large as fits the screen, in its own proportions. */
export function fitted(natural: Size | null, screen: Size): Size {
  if (!natural || natural.width <= 0 || natural.height <= 0) return screen;
  const ratio = Math.min(screen.width / natural.width, screen.height / natural.height);
  return { width: natural.width * ratio, height: natural.height * ratio };
}

/**
 * No zooming out past fit, and no panning past the picture's edges: once it's
 * bigger than the screen its edges stop at the screen's; smaller, it stays centred.
 */
export function clampView(view: ZoomView, screen: Size, picture: Size = screen): ZoomView {
  const scale = clamp(view.scale, MIN_SCALE, MAX_SCALE);
  const maxX = Math.max(0, (scale * picture.width - screen.width) / 2);
  const maxY = Math.max(0, (scale * picture.height - screen.height) / 2);
  return { scale, x: clamp(view.x, -maxX, maxX), y: clamp(view.y, -maxY, maxY) };
}

/**
 * Two fingers: zoom by how far apart they've moved, keeping the spot that was
 * between them under them (so you zoom into what you're pinching), and pan
 * as they move together.
 */
export function pinch(start: ZoomView, from: { focal: Point; distance: number }, to: { focal: Point; distance: number }): ZoomView {
  const scale = clamp((start.scale * to.distance) / Math.max(1, from.distance), MIN_SCALE * 0.85, MAX_SCALE * 1.15);
  const px = (from.focal.x - start.x) / start.scale;
  const py = (from.focal.y - start.y) / start.scale;
  return { scale, x: to.focal.x - scale * px, y: to.focal.y - scale * py };
}

/** Double tap: zoom in on that spot, or back out to fit. */
export function toggleZoom(view: ZoomView, at: Point, screen: Size, picture: Size = screen): ZoomView {
  if (view.scale > 1.05) return IDENTITY;
  const scale = DOUBLE_TAP_SCALE;
  const px = (at.x - view.x) / view.scale;
  const py = (at.y - view.y) / view.scale;
  return clampView({ scale, x: at.x - scale * px, y: at.y - scale * py }, screen, picture);
}
