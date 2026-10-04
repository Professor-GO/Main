/**
 * Draws one screen of the campus map on a canvas, seen from straight above: square grass
 * tiles, with scenery, the house, Legendary professors, and the player standing upright on
 * them. Things are drawn from the top of the screen down, so something lower on the screen
 * covers whatever stands behind it. That is how a tree's leaves hide a player walking behind
 * its trunk, while a player in front of the trunk is drawn over the tree.
 */
import { PROP_ART, professorArt } from "./art";
import {
  CANOPY,
  HOUSE,
  SCREEN_TILES,
  WORLD_SCREENS,
  screenName,
} from "./Game Mechanics/world";
import type {
  Direction,
  Point,
  Prop,
  PropKind,
  Screen,
  Spawn,
} from "./Game Mechanics/world";

/** The size of one tile on the canvas, in pixels. */
const TILE = 48;
/** The canvas size the scene is drawn at, before scaling for the screen's pixel density. */
export const CANVAS_WIDTH = SCREEN_TILES * TILE;
export const CANVAS_HEIGHT = SCREEN_TILES * TILE;
// How tall each kind of scenery is drawn, in pixels. Trees match the CANOPY the rules use.
const PROP_HEIGHT: Partial<Record<PropKind, number>> = {
  oak: CANOPY.height * TILE,
  pine: CANOPY.height * TILE,
  bush: 46,
  rock: 34,
  flowers: 30,
  mailbox: 46,
};
// Half the house's width and depth, in tiles.
const HOUSE_HALF =
  HOUSE.footprint?.kind === "box" ? HOUSE.footprint.halfWidth : 1.5;

/** Everything needed to draw one frame. */
export type Scene = {
  screen: Screen;
  props: readonly Prop[];
  spawns: readonly (Spawn & { name: string })[];
  player: { position: Point; facing: Direction; walking: boolean };
  // Seconds since the map opened; drives the walking and glowing animations.
  time: number;
};

/** Loads pictures once and remembers them. */
export type ImageCache = (url: string) => HTMLImageElement | undefined;

/**
 * Creates an image cache. A picture is only drawn once it has finished loading.
 * @returns A function that returns the loaded picture for a URL, or undefined while it loads.
 */
export function createImageCache(): ImageCache {
  const images = new Map<string, HTMLImageElement>();
  return (url) => {
    let image = images.get(url);
    if (!image) {
      image = new Image();
      image.src = url;
      images.set(url, image);
    }
    return image.complete && image.naturalWidth > 0 ? image : undefined;
  };
}

/**
 * Turns a position on the current screen into a point on the canvas.
 * @param x - Tiles from the screen's left edge.
 * @param y - Tiles from the screen's top edge.
 * @returns The canvas point.
 */
function toCanvas(x: number, y: number): Point {
  return { x: x * TILE, y: y * TILE };
}

/**
 * Draws a whole frame: the ground, flowers, the edge signposts, then everything standing on
 * the ground from the top of the screen down.
 * @param context - The canvas to draw on, already scaled to CANVAS_WIDTH × CANVAS_HEIGHT.
 * @param scene - What to draw.
 * @param images - Where to get pictures from.
 */
export function drawScene(
  context: CanvasRenderingContext2D,
  scene: Scene,
  images: ImageCache,
): void {
  const left = scene.screen.col * SCREEN_TILES;
  const top = scene.screen.row * SCREEN_TILES;
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  drawGround(context, scene.screen);
  // Flowers lie flat on the grass, so the player always walks over them.
  for (const prop of scene.props) {
    if (prop.kind === "flowers")
      drawProp(context, prop.kind, prop.x - left, prop.y - top, images);
  }

  // Everything else stands upright and is drawn in order of its base, from the top down.
  const drawables: { base: number; draw: () => void }[] = [];
  for (const prop of scene.props) {
    const x = prop.x - left;
    const y = prop.y - top;
    if (prop.kind === "flowers") continue;
    drawables.push(
      prop.kind === "house"
        ? { base: y + HOUSE_HALF, draw: () => drawHouse(context, x, y) }
        : { base: y, draw: () => drawProp(context, prop.kind, x, y, images) },
    );
  }
  for (const spawn of scene.spawns) {
    const x = spawn.x - left;
    const y = spawn.y - top;
    drawables.push({
      base: y,
      draw: () => drawSpawn(context, spawn, x, y, scene.time, images),
    });
  }
  const player = {
    x: scene.player.position.x - left,
    y: scene.player.position.y - top,
  };
  drawables.push({
    base: player.y,
    draw: () =>
      drawPlayer(
        context,
        player,
        scene.player.facing,
        scene.player.walking,
        scene.time,
      ),
  });
  drawables.sort((a, b) => a.base - b.base);
  for (const drawable of drawables) drawable.draw();

  drawSignposts(context, scene.screen);
}

/**
 * Draws the checkerboard grass tiles with a few grass tufts.
 * @param context - The canvas.
 * @param screen - The screen being drawn; it decides where the tufts go.
 */
function drawGround(context: CanvasRenderingContext2D, screen: Screen): void {
  for (let x = 0; x < SCREEN_TILES; x++) {
    for (let y = 0; y < SCREEN_TILES; y++) {
      context.fillStyle = (x + y) % 2 ? "#86c062" : "#8fc86b";
      context.fillRect(x * TILE, y * TILE, TILE, TILE);
      // A tuft of grass on roughly one tile in five, always on the same tiles.
      const hash =
        (x * 73856093) ^
        (y * 19349663) ^
        (screen.col * 83492791) ^
        (screen.row * 2654435761);
      if (Math.abs(hash) % 5 === 0)
        drawTuft(context, toCanvas(x + 0.5, y + 0.6));
    }
  }
}

/**
 * Draws a small tuft of grass.
 * @param context - The canvas.
 * @param at - Where the tuft grows.
 */
function drawTuft(context: CanvasRenderingContext2D, at: Point): void {
  context.strokeStyle = "#5f9a43";
  context.lineWidth = 1.6;
  context.lineCap = "round";
  context.beginPath();
  for (const lean of [-4, 0, 4]) {
    context.moveTo(at.x + lean * 0.4, at.y + 3);
    context.lineTo(at.x + lean, at.y - 4);
  }
  context.stroke();
}

/**
 * Labels each edge of the screen with the screen it leads to, so players can find their way.
 * The labels wrap around too: off the left of column A is column E.
 * @param context - The canvas.
 * @param screen - The screen being drawn.
 */
function drawSignposts(
  context: CanvasRenderingContext2D,
  screen: Screen,
): void {
  const wrapIndex = (value: number) => (value + WORLD_SCREENS) % WORLD_SCREENS;
  const middle = CANVAS_WIDTH / 2;
  const edges: { x: number; y: number; to: Screen; arrow: string }[] = [
    {
      x: middle,
      y: 14,
      to: { col: screen.col, row: wrapIndex(screen.row - 1) },
      arrow: "↑",
    },
    {
      x: CANVAS_WIDTH - 30,
      y: middle,
      to: { col: wrapIndex(screen.col + 1), row: screen.row },
      arrow: "→",
    },
    {
      x: middle,
      y: CANVAS_HEIGHT - 14,
      to: { col: screen.col, row: wrapIndex(screen.row + 1) },
      arrow: "↓",
    },
    {
      x: 30,
      y: middle,
      to: { col: wrapIndex(screen.col - 1), row: screen.row },
      arrow: "←",
    },
  ];
  // Courier New has no arrow characters, so the signposts use the page's sans-serif font.
  context.font = "bold 12px 'Segoe UI', Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const edge of edges) {
    const text = `${edge.arrow} ${screenName(edge.to)}`;
    const width = context.measureText(text).width + 14;
    context.fillStyle = "rgb(248 249 243 / 0.85)";
    context.beginPath();
    context.roundRect(edge.x - width / 2, edge.y - 10, width, 20, 10);
    context.fill();
    context.fillStyle = "#254b3f";
    context.fillText(text, edge.x, edge.y + 1);
  }
}

/**
 * Draws a soft shadow on the ground.
 * @param context - The canvas.
 * @param at - The point on the ground under the thing casting it.
 * @param radiusX - The shadow's half-width.
 * @param radiusY - The shadow's half-height.
 */
function drawShadow(
  context: CanvasRenderingContext2D,
  at: Point,
  radiusX: number,
  radiusY: number,
): void {
  context.fillStyle = "rgb(30 50 30 / 0.22)";
  context.beginPath();
  context.ellipse(at.x, at.y, radiusX, radiusY, 0, 0, Math.PI * 2);
  context.fill();
}

/**
 * Draws a piece of scenery from its picture, standing upright with its base on the ground.
 * @param context - The canvas.
 * @param kind - What it is.
 * @param x - Its base on the screen, in tiles.
 * @param y - Its base on the screen, in tiles.
 * @param images - Where to get pictures from.
 */
function drawProp(
  context: CanvasRenderingContext2D,
  kind: PropKind,
  x: number,
  y: number,
  images: ImageCache,
): void {
  const url = PROP_ART[kind];
  const image = url ? images(url) : undefined;
  const height = PROP_HEIGHT[kind] ?? 40;
  const base = toCanvas(x, y);
  if (kind !== "flowers")
    drawShadow(context, base, Math.min(height * 0.3, 26), 7);
  if (!image) return;
  const width = (image.naturalWidth / image.naturalHeight) * height;
  // The pictures have a few pixels of empty border, so they sit slightly below the base.
  context.drawImage(
    image,
    base.x - width / 2,
    base.y - height + 4,
    width,
    height,
  );
}

/**
 * Draws the player's house, seen from above with its front wall showing: a red roof, cream
 * walls, a door facing down the screen, and two windows.
 * @param context - The canvas.
 * @param x - The middle of the house on the screen, in tiles.
 * @param y - The middle of the house on the screen, in tiles.
 */
function drawHouse(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  const left = (x - HOUSE_HALF) * TILE;
  const right = (x + HOUSE_HALF) * TILE;
  const bottom = (y + HOUSE_HALF) * TILE;
  const width = right - left;
  // The front wall fills the lower part of the footprint; the roof covers the rest and
  // overhangs a little above it, as a roof seen from above would.
  const wallTop = bottom - 1.3 * TILE;
  const roofTop = (y - HOUSE_HALF - 0.6) * TILE;
  const roofBottom = wallTop + 10;
  context.lineJoin = "round";
  context.strokeStyle = "#3b2a1e";
  context.lineWidth = 2;
  drawShadow(context, { x: x * TILE, y: bottom }, width * 0.55, 10);

  // Front wall, with a door in the middle and a window either side.
  context.fillStyle = "#f3e4c4";
  context.fillRect(left, wallTop, width, bottom - wallTop);
  context.strokeRect(left, wallTop, width, bottom - wallTop);
  const doorWidth = 0.7 * TILE;
  const doorTop = bottom - 0.95 * TILE;
  context.fillStyle = "#7a4a2a";
  context.beginPath();
  context.roundRect(
    x * TILE - doorWidth / 2,
    doorTop,
    doorWidth,
    bottom - doorTop,
    [8, 8, 0, 0],
  );
  context.fill();
  context.stroke();
  context.fillStyle = "#f2c94c";
  context.beginPath();
  context.arc(
    x * TILE + doorWidth / 4,
    bottom - 0.45 * TILE,
    2.2,
    0,
    Math.PI * 2,
  );
  context.fill();
  for (const side of [-1, 1]) {
    const windowX = x * TILE + side * 0.95 * TILE - 0.3 * TILE;
    context.fillStyle = "#a8d8f0";
    context.fillRect(windowX, doorTop + 4, 0.6 * TILE, 0.5 * TILE);
    context.strokeRect(windowX, doorTop + 4, 0.6 * TILE, 0.5 * TILE);
  }

  // The roof: two slopes meeting at a ridge, with shingle lines.
  const overhang = 0.2 * TILE;
  const ridge = (roofTop + roofBottom) / 2;
  const slopes: [number, number, string][] = [
    [roofTop, ridge, "#b44a34"],
    [ridge, roofBottom, "#c4553f"],
  ];
  for (const [from, to, colour] of slopes) {
    context.fillStyle = colour;
    context.fillRect(left - overhang, from, width + overhang * 2, to - from);
    context.strokeRect(left - overhang, from, width + overhang * 2, to - from);
  }
  context.strokeStyle = "rgb(59 42 30 / 0.35)";
  context.lineWidth = 1;
  context.beginPath();
  for (let line = roofTop + 9; line < roofBottom - 4; line += 9) {
    if (Math.abs(line - ridge) < 4) continue;
    context.moveTo(left - overhang + 4, line);
    context.lineTo(right + overhang - 4, line);
  }
  context.stroke();
}

/**
 * Draws a Legendary professor: a glowing golden token with their face, floating gently above a
 * pool of light, with their name above.
 * @param context - The canvas.
 * @param spawn - The professor.
 * @param x - Their position on the screen, in tiles.
 * @param y - Their position on the screen, in tiles.
 * @param time - Seconds since the map opened, for the floating and glowing.
 * @param images - Where to get pictures from.
 */
function drawSpawn(
  context: CanvasRenderingContext2D,
  spawn: Spawn & { name: string },
  x: number,
  y: number,
  time: number,
  images: ImageCache,
): void {
  const base = toCanvas(x, y);
  const pulse = 0.5 + 0.5 * Math.sin(time * 3 + spawn.id);
  const glow = context.createRadialGradient(
    base.x,
    base.y,
    2,
    base.x,
    base.y,
    30,
  );
  glow.addColorStop(0, `rgb(255 214 77 / ${0.55 + pulse * 0.3})`);
  glow.addColorStop(1, "rgb(255 214 77 / 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.ellipse(base.x, base.y, 30, 13, 0, 0, Math.PI * 2);
  context.fill();

  const radius = 22;
  const centre = {
    x: base.x,
    y: base.y - 38 - Math.sin(time * 2.4 + spawn.id) * 4,
  };
  const url = professorArt(spawn.professorId);
  const image = url ? images(url) : undefined;
  context.save();
  context.beginPath();
  context.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
  context.fillStyle = "#fff6d6";
  context.fill();
  if (image) {
    // The pictures are portraits with the face near the top, so crop to the face.
    context.clip();
    const size = image.naturalWidth * 0.56;
    context.drawImage(
      image,
      image.naturalWidth * 0.22,
      image.naturalHeight * 0.02,
      size,
      size,
      centre.x - radius,
      centre.y - radius,
      radius * 2,
      radius * 2,
    );
  }
  context.restore();
  context.strokeStyle = "#e0a800";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
  context.stroke();

  // Two sparkles circling the token.
  context.fillStyle = "#f2b705";
  context.font = "bold 14px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const offset of [0, Math.PI]) {
    const angle = time * 1.8 + offset;
    context.fillText(
      "✦",
      centre.x + Math.cos(angle) * 31,
      centre.y + Math.sin(angle) * 12,
    );
  }

  // Their name on a dark tag above the token.
  const label = `★ ${spawn.name}`;
  context.font = "bold 11px 'Segoe UI', Arial, sans-serif";
  const width = context.measureText(label).width + 14;
  context.fillStyle = "rgb(37 75 63 / 0.92)";
  context.beginPath();
  context.roundRect(centre.x - width / 2, centre.y - radius - 24, width, 18, 9);
  context.fill();
  context.fillStyle = "#ffe08a";
  context.fillText(label, centre.x, centre.y - radius - 14);
}

/**
 * Draws the player: a small student in a green jacket and lime cap, facing the way they walk,
 * with legs that swing while walking.
 * @param context - The canvas.
 * @param at - Where they stand on the screen, in tiles.
 * @param facing - The way they face.
 * @param walking - Whether they are walking right now.
 * @param time - Seconds since the map opened, for the walking animation.
 */
function drawPlayer(
  context: CanvasRenderingContext2D,
  at: Point,
  facing: Direction,
  walking: boolean,
  time: number,
): void {
  const base = toCanvas(at.x, at.y);
  const swing = walking ? Math.sin(time * 12) : 0;
  const bob = walking ? Math.abs(swing) * 2.5 : 0;
  const away = facing.startsWith("n");
  const side = facing.endsWith("e") ? 1 : facing.endsWith("w") ? -1 : 0;
  drawShadow(context, base, 12, 5);

  context.lineJoin = "round";
  context.strokeStyle = "#1d2e27";
  context.lineWidth = 1.5;
  // Legs.
  context.fillStyle = "#3a4a5c";
  for (const [offset, phase] of [
    [-4.5, swing],
    [1.5, -swing],
  ] as const) {
    context.beginPath();
    context.roundRect(base.x + offset, base.y - 15 - bob, 5, 14 + phase * 2, 2);
    context.fill();
    context.stroke();
  }
  // Body: a green jacket, with a lime backpack when seen from behind.
  const bodyTop = base.y - 36 - bob;
  context.fillStyle = "#254b3f";
  context.beginPath();
  context.roundRect(base.x - 11, bodyTop, 22, 23, 7);
  context.fill();
  context.stroke();
  if (away) {
    context.fillStyle = "#c3df6f";
    context.beginPath();
    context.roundRect(base.x - 7, bodyTop + 3, 14, 14, 4);
    context.fill();
    context.stroke();
  }
  // Head.
  const head = { x: base.x + side * 1.5, y: bodyTop - 9 };
  context.fillStyle = away ? "#3b2a1e" : "#f1c7a1";
  context.beginPath();
  context.arc(head.x, head.y, 10.5, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  // A lime cap, with its brim pointing the way they face.
  context.fillStyle = "#c3df6f";
  context.beginPath();
  context.ellipse(head.x, head.y - 5, 11, 7, 0, Math.PI, 0);
  context.fill();
  context.stroke();
  if (!away) {
    context.beginPath();
    context.ellipse(
      head.x + side * 7,
      head.y - 4,
      side ? 7 : 10,
      3,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.stroke();
    // Eyes: two when facing the viewer, one when seen side-on.
    context.fillStyle = "#1d2e27";
    const eyes = side ? [side * 5] : [-3.5, 3.5];
    for (const eye of eyes) {
      context.beginPath();
      context.arc(head.x + eye, head.y + 2, 1.6, 0, Math.PI * 2);
      context.fill();
    }
  }
}
