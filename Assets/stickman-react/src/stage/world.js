export const WORLD = { w: 960, h: 540, floor: 230 };   // SVG user units
export const SCALE = 0.36;                              // size of a character relative to its 400x600 rig
export const SPEED = 220;                               // units / second
export const ENEMY_POS = { x: 700, y: 340 };
export const BOUNDS = { x0: 60, x1: WORLD.w - 60, y0: WORLD.floor + 20, y1: WORLD.h - 30 };

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Perspective: farther (smaller y) = smaller. */
export const depthScale = (y) => SCALE * (0.6 + 0.5 * clamp((y - BOUNDS.y0) / (BOUNDS.y1 - BOUNDS.y0), 0, 1));
