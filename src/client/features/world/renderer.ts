/**
 * Draws one screen of the campus map, or one room, on a canvas, seen from straight above:
 * square tiles with scenery and buildings standing upright on them. Things are drawn from the
 * top of the screen down, so something lower on the screen covers whatever stands behind it.
 * The player and the wild professors are animated stickmen drawn over the canvas (see
 * ActorLayer); the canvas only marks where each wild professor stands.
 */
import { PROP_ART, ROOM_ART, TEXTURES, WINDOW_ART } from "./art";
import { ROOM_DOOR, ROOM_DOOR_WIDTH, WALLS } from "./Game Mechanics/rooms";
import type { Room } from "./Game Mechanics/rooms";
import {
  CANOPY,
  HOUSE,
  SCHOOL,
  SCREEN_TILES,
  WORLD_SCREENS,
  screenName,
} from "./Game Mechanics/world";
import type {
  Point,
  Prop,
  PropKind,
  Screen,
  Spawn,
} from "./Game Mechanics/world";

/** The size of one tile on the canvas, in pixels. */
export const TILE = 48;
/** How tall the stickmen are drawn over the canvas, in pixels. */
export const ACTOR_HEIGHT = 100;
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
  // Seconds since the map opened; drives the glowing animation.
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
 * Draws a whole frame of the campus: the ground, flowers, the edge signposts, then everything
 * standing on the ground from the top of the screen down.
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
        : prop.kind === "school"
          ? {
              base: y + HOUSE_HALF,
              draw: () => drawSchool(context, x, y, images),
            }
          : { base: y, draw: () => drawProp(context, prop.kind, x, y, images) },
    );
  }
  for (const spawn of scene.spawns) {
    const x = spawn.x - left;
    const y = spawn.y - top;
    drawables.push({
      base: y,
      draw: () => drawSpawn(context, spawn, x, y, scene.time),
    });
  }
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
 * Marks where a wild professor stands: a pulsing pool of light on the ground and their name
 * above their head. The professor themselves is an animated stickman drawn over the canvas.
 * Draws a Legendary professor: a glowing golden token with their face, floating gently above a
 * pool of light, with their name above. One chasing the player glows red instead.
 * @param context - The canvas.
 * @param spawn - The professor.
 * @param x - Their position on the screen, in tiles.
 * @param y - Their position on the screen, in tiles.
 * @param time - Seconds since the map opened, for the glowing.
 */
function drawSpawn(
  context: CanvasRenderingContext2D,
  spawn: Spawn & { name: string },
  x: number,
  y: number,
  time: number,
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
  const glowColour = spawn.chasing ? "235 64 52" : "255 214 77";
  glow.addColorStop(0, `rgb(${glowColour} / ${0.55 + pulse * 0.3})`);
  glow.addColorStop(1, `rgb(${glowColour} / 0)`);
  context.fillStyle = glow;
  context.beginPath();
  context.ellipse(base.x, base.y, 30, 13, 0, 0, Math.PI * 2);
  context.fill();

  drawNameTag(context, base, `★ ${spawn.name}`);
}
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
  context.strokeStyle = spawn.chasing ? "#d62b1f" : "#e0a800";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
  context.stroke();

/**
 * Writes a name on a dark tag above where a stickman's head is.
 * @param context - The canvas.
 * @param base - Where the stickman's feet are, in pixels.
 * @param label - The name.
 */
function drawNameTag(
  context: CanvasRenderingContext2D,
  base: Point,
  label: string,
): void {
  context.font = "bold 11px 'Segoe UI', Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const width = context.measureText(label).width + 14;
  const tagY = base.y - ACTOR_HEIGHT - 16;
  context.fillStyle = "rgb(37 75 63 / 0.92)";
  for (const offset of [0, Math.PI]) {
    const angle = time * 1.8 + offset;
    context.fillText(
      "✦",
      centre.x + Math.cos(angle) * 31,
      centre.y + Math.sin(angle) * 12,
    );
  }

  // Their name on a dark tag above the token.
  const label = spawn.chasing ? `! ${spawn.name} !` : `★ ${spawn.name}`;
  context.font = "bold 11px 'Segoe UI', Arial, sans-serif";
  const width = context.measureText(label).width + 14;
  context.fillStyle = spawn.chasing ? "rgb(122 22 16 / 0.92)" : "rgb(37 75 63 / 0.92)";
  context.beginPath();
  context.roundRect(base.x - width / 2, tagY - 9, width, 18, 9);
  context.fill();
  context.fillStyle = "#ffe08a";
  context.fillText(label, base.x, tagY + 1);
}

/**
 * Fills the current path's rectangle with a repeating picture, such as floorboards or bricks.
 * @param context - The canvas.
 * @param image - The texture, or undefined while it loads.
 * @param fallback - The colour to use until the texture has loaded.
 * @param rectangle - The area to fill, in pixels: [x, y, width, height].
 */
function fillTexture(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | undefined,
  fallback: string,
  rectangle: [number, number, number, number],
): void {
  let pattern: CanvasPattern | null = null;
  if (image) {
    pattern = context.createPattern(image, "repeat");
    // The textures are large pictures; shrink them so one repeat is two tiles wide.
    const scale = (2 * TILE) / image.naturalWidth;
    pattern?.setTransform(new DOMMatrix().scale(scale));
  }
  context.fillStyle = pattern ?? fallback;
  context.fillRect(...rectangle);
}

/**
 * Draws the school, seen from above with its front wall showing: a brick wall with windows
 * and double doors facing down the screen, under a flat slate roof.
 * @param context - The canvas.
 * @param x - The middle of the school on the screen, in tiles.
 * @param y - The middle of the school on the screen, in tiles.
 * @param images - Where to get pictures from.
 */
function drawSchool(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  images: ImageCache,
): void {
  const half = SCHOOL.footprint?.kind === "box" ? SCHOOL.footprint : null;
  const halfWidth = half?.halfWidth ?? 2.5;
  const halfDepth = half?.halfDepth ?? 1.5;
  const left = (x - halfWidth) * TILE;
  const width = halfWidth * 2 * TILE;
  const bottom = (y + halfDepth) * TILE;
  const wallTop = bottom - 1.6 * TILE;
  const roofTop = (y - halfDepth - 0.6) * TILE;
  context.lineJoin = "round";
  context.strokeStyle = "#2b2b2b";
  context.lineWidth = 2;
  drawShadow(context, { x: x * TILE, y: bottom }, width * 0.55, 10);

  // The roof, then the front wall over its lower edge.
  context.fillStyle = "#5b6470";
  context.fillRect(left - 8, roofTop, width + 16, wallTop + 10 - roofTop);
  context.strokeRect(left - 8, roofTop, width + 16, wallTop + 10 - roofTop);
  fillTexture(context, images(TEXTURES.brick), "#8a8a8a", [
    left,
    wallTop,
    width,
    bottom - wallTop,
  ]);
  context.strokeRect(left, wallTop, width, bottom - wallTop);

  // Two windows either side of the doors.
  const windowImage = images(WINDOW_ART);
  for (const offset of [-1.85, -0.95, 0.95, 1.85]) {
    const windowWidth = 0.7 * TILE;
    const windowHeight = 0.55 * TILE;
    const windowLeft = (x + offset) * TILE - windowWidth / 2;
    if (windowImage)
      context.drawImage(
        windowImage,
        windowLeft,
        wallTop + 22,
        windowWidth,
        windowHeight,
      );
    else {
      context.fillStyle = "#a8d8f0";
      context.fillRect(windowLeft, wallTop + 22, windowWidth, windowHeight);
    }
  }
  // Double doors in the middle, under the school's sign.
  const doorWidth = 0.95 * TILE;
  const doorTop = bottom - 0.95 * TILE;
  context.fillStyle = "#7a4a2a";
  context.fillRect(
    x * TILE - doorWidth / 2,
    doorTop,
    doorWidth,
    bottom - doorTop,
  );
  context.strokeRect(
    x * TILE - doorWidth / 2,
    doorTop,
    doorWidth,
    bottom - doorTop,
  );
  context.beginPath();
  context.moveTo(x * TILE, doorTop);
  context.lineTo(x * TILE, bottom);
  context.stroke();
  context.font = "bold 12px 'Segoe UI', Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const sign = "SCHOOL";
  const signWidth = context.measureText(sign).width + 16;
  context.fillStyle = "#254b3f";
  context.fillRect(x * TILE - signWidth / 2, wallTop + 4, signWidth, 16);
  context.fillStyle = "#f6f8ec";
  context.fillText(sign, x * TILE, wallTop + 13);
}

/** Everything needed to draw one frame of a room. */
export type RoomScene = {
  room: Room;
  spawns: readonly (Spawn & { name: string })[];
  time: number;
};

/**
 * Draws a whole frame of a room: the floor, the brick wall along the top, the thin black
 * walls down the sides and along the bottom, the doormat, then the furniture from the top of
 * the screen down. The player and any wild professor are stickmen drawn over the canvas.
 * @param context - The canvas to draw on, already scaled to CANVAS_WIDTH × CANVAS_HEIGHT.
 * @param scene - What to draw.
 * @param images - Where to get pictures from.
 */
export function drawRoom(
  context: CanvasRenderingContext2D,
  scene: RoomScene,
  images: ImageCache,
): void {
  const { room } = scene;
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  fillTexture(
    context,
    images(TEXTURES[room.floor]),
    room.floor === "wood" ? "#c98a4b" : "#e8d5ac",
    [0, 0, CANVAS_WIDTH, CANVAS_HEIGHT],
  );
  const wallBottom = WALLS.top * TILE;
  fillTexture(context, images(TEXTURES.brick), "#8a8a8a", [
    0,
    0,
    CANVAS_WIDTH,
    wallBottom,
  ]);
  // A shadow where the wall meets the floor.
  context.fillStyle = "rgb(0 0 0 / 0.18)";
  context.fillRect(0, wallBottom, CANVAS_WIDTH, 6);

  // The side and bottom walls are long black lines; the bottom one has a gap for the door.
  const side = WALLS.side * TILE;
  const bottomTop = CANVAS_HEIGHT - WALLS.bottom * TILE;
  const doorLeft = (ROOM_DOOR.x - ROOM_DOOR_WIDTH / 2) * TILE;
  const doorRight = (ROOM_DOOR.x + ROOM_DOOR_WIDTH / 2) * TILE;
  context.fillStyle = "#111111";
  context.fillRect(0, 0, side, CANVAS_HEIGHT);
  context.fillRect(CANVAS_WIDTH - side, 0, side, CANVAS_HEIGHT);
  context.fillRect(0, bottomTop, doorLeft, CANVAS_HEIGHT - bottomTop);
  context.fillRect(
    doorRight,
    bottomTop,
    CANVAS_WIDTH - doorRight,
    CANVAS_HEIGHT - bottomTop,
  );
  // The doormat, just inside the door.
  context.fillStyle = "#7a4a2a";
  context.beginPath();
  context.roundRect(
    doorLeft + 4,
    bottomTop - 20,
    doorRight - doorLeft - 8,
    16,
    4,
  );
  context.fill();

  // Things on the wall first, then the furniture from the top of the screen down.
  const items = [...room.items].sort(
    (a, b) => Number(!!a.block) - Number(!!b.block) || a.y - b.y,
  );
  for (const item of items) {
    const image = images(ROOM_ART[item.art]);
    if (!image) continue;
    const height = item.height * TILE;
    const width = (image.naturalWidth / image.naturalHeight) * height;
    context.drawImage(
      image,
      item.x * TILE - width / 2,
      item.y * TILE - height + 4,
      width,
      height,
    );
  }
  for (const spawn of scene.spawns)
    drawSpawn(context, spawn, spawn.x, spawn.y, scene.time);
  if (room.npc)
    drawNameTag(context, toCanvas(room.npc.x, room.npc.y), room.npc.name);
}
