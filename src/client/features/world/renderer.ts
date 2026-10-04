/**
 * Draws one screen of the campus map on a canvas in 2.5D (isometric): diamond-shaped grass
 * tiles on a raised slab, with scenery, the house, Legendary professors, and the player standing
 * upright on top, drawn back to front so nearer things cover farther ones.
 */
import { PROP_ART, professorArt } from "./art";
import { HOUSE, SCREEN_TILES, WORLD_SCREENS, screenName } from "./world";
import type { Direction, Point, Prop, PropKind, Screen, Spawn } from "./world";

/** The canvas size the scene is drawn at, before scaling for the screen's pixel density. */
export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 560;
// One tile's diamond is this wide and tall on the canvas.
const TILE_WIDTH = 72;
const TILE_HEIGHT = 36;
// Where the screen's top (north) corner is drawn.
const ORIGIN_X = CANVAS_WIDTH / 2;
const ORIGIN_Y = 88;
// How thick the slab of ground under the tiles looks.
const SLAB_DEPTH = 18;
// How tall each kind of scenery is drawn, in canvas pixels.
const PROP_HEIGHT: Partial<Record<PropKind, number>> = {
  oak: 104,
  pine: 108,
  bush: 46,
  rock: 34,
  flowers: 34,
  mailbox: 50,
};

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
 * @param x - Tiles from the screen's left (north-west) edge.
 * @param y - Tiles from the screen's right (north-east) edge.
 * @param height - How far above the ground, in canvas pixels.
 * @returns The canvas point.
 */
function project(x: number, y: number, height = 0): Point {
  return {
    x: ORIGIN_X + ((x - y) * TILE_WIDTH) / 2,
    y: ORIGIN_Y + ((x + y) * TILE_HEIGHT) / 2 - height,
  };
}

/**
 * Traces a closed shape through canvas points.
 * @param context - The canvas to draw on.
 * @param points - The corners, in order.
 */
function polygon(
  context: CanvasRenderingContext2D,
  points: readonly Point[],
): void {
  context.beginPath();
  points.forEach((point, index) =>
    index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y),
  );
  context.closePath();
}

/**
 * Draws a whole frame: the ground, the edge signposts, then everything standing on the ground.
 * @param context - The canvas to draw on, already scaled to CANVAS_WIDTH × CANVAS_HEIGHT.
 * @param scene - What to draw.
 * @param images - Where to get pictures from.
 */
export function drawScene(
  context: CanvasRenderingContext2D,
  scene: Scene,
  images: ImageCache,
): void {
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  drawGround(context, scene.screen);
  drawSignposts(context, scene.screen);

  const left = scene.screen.col * SCREEN_TILES;
  const top = scene.screen.row * SCREEN_TILES;
  const player = {
    x: scene.player.position.x - left,
    y: scene.player.position.y - top,
  };
  // Things nearer the bottom of the screen (bigger x + y) are drawn later, on top.
  const drawables: { depth: number; draw: () => void }[] = [];
  for (const prop of scene.props) {
    const x = prop.x - left;
    const y = prop.y - top;
    if (prop.kind === "house") {
      // The player is in front of the house when they are past its front walls.
      const inFront = player.x >= x + HOUSE_HALF || player.y >= y + HOUSE_HALF;
      drawables.push({
        depth: player.x + player.y + (inFront ? -0.001 : 0.001),
        draw: () => drawHouse(context, x, y),
      });
    } else {
      drawables.push({
        depth: x + y,
        draw: () => drawProp(context, prop.kind, x, y, images),
      });
    }
  }
  for (const spawn of scene.spawns) {
    const x = spawn.x - left;
    const y = spawn.y - top;
    drawables.push({
      depth: x + y,
      draw: () => drawSpawn(context, spawn, x, y, scene.time, images),
    });
  }
  drawables.push({
    depth: player.x + player.y,
    draw: () =>
      drawPlayer(
        context,
        player,
        scene.player.facing,
        scene.player.walking,
        scene.time,
      ),
  });
  drawables.sort((a, b) => a.depth - b.depth);
  for (const drawable of drawables) drawable.draw();
}

/**
 * Draws the slab of ground with its checkerboard grass tiles and a few grass tufts.
 * @param context - The canvas.
 * @param screen - The screen being drawn; it seeds where the tufts go.
 */
function drawGround(context: CanvasRenderingContext2D, screen: Screen): void {
  const north = project(0, 0);
  const east = project(SCREEN_TILES, 0);
  const south = project(SCREEN_TILES, SCREEN_TILES);
  const west = project(0, SCREEN_TILES);
  const down = (point: Point) => ({ x: point.x, y: point.y + SLAB_DEPTH });
  // The slab's two visible sides: soil under the grass.
  polygon(context, [west, south, down(south), down(west)]);
  context.fillStyle = "#8d6b45";
  context.fill();
  polygon(context, [south, east, down(east), down(south)]);
  context.fillStyle = "#73563a";
  context.fill();

  for (let x = 0; x < SCREEN_TILES; x++) {
    for (let y = 0; y < SCREEN_TILES; y++) {
      polygon(context, [
        project(x, y),
        project(x + 1, y),
        project(x + 1, y + 1),
        project(x, y + 1),
      ]);
      context.fillStyle = (x + y) % 2 ? "#86c062" : "#8fc86b";
      context.fill();
      // A tuft of grass on roughly one tile in five, always on the same tiles.
      const hash =
        (x * 73856093) ^
        (y * 19349663) ^
        (screen.col * 83492791) ^
        (screen.row * 2654435761);
      if (Math.abs(hash) % 5 === 0)
        drawTuft(context, project(x + 0.5, y + 0.5));
    }
  }
  // A soft outline around the whole screen.
  polygon(context, [north, east, south, west]);
  context.strokeStyle = "rgb(37 75 63 / 0.35)";
  context.lineWidth = 2;
  context.stroke();
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
  const half = SCREEN_TILES / 2;
  const edges: {
    at: Point;
    to: Screen;
    arrow: string;
    dx: number;
    dy: number;
  }[] = [
    {
      at: project(half, 0),
      to: { col: screen.col, row: wrapIndex(screen.row - 1) },
      arrow: "↗",
      dx: 24,
      dy: -14,
    },
    {
      at: project(SCREEN_TILES, half),
      to: { col: wrapIndex(screen.col + 1), row: screen.row },
      arrow: "↘",
      dx: 24,
      dy: 18,
    },
    {
      at: project(half, SCREEN_TILES),
      to: { col: screen.col, row: wrapIndex(screen.row + 1) },
      arrow: "↙",
      dx: -24,
      dy: 18,
    },
    {
      at: project(0, half),
      to: { col: wrapIndex(screen.col - 1), row: screen.row },
      arrow: "↖",
      dx: -24,
      dy: -14,
    },
  ];
  context.font = "bold 12px 'Courier New', monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const edge of edges) {
    const text = `${edge.arrow} ${screenName(edge.to)}`;
    const x = edge.at.x + edge.dx;
    const y = edge.at.y + edge.dy;
    const width = context.measureText(text).width + 14;
    context.fillStyle = "rgb(248 249 243 / 0.9)";
    context.beginPath();
    context.roundRect(x - width / 2, y - 10, width, 20, 10);
    context.fill();
    context.fillStyle = "#254b3f";
    context.fillText(text, x, y + 1);
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
 * @param x - Its position on the screen, in tiles.
 * @param y - Its position on the screen, in tiles.
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
  const base = project(x, y);
  if (kind !== "flowers")
    drawShadow(
      context,
      { x: base.x, y: base.y + 2 },
      height * 0.32,
      height * 0.11,
    );
  if (!image) return;
  const width = (image.naturalWidth / image.naturalHeight) * height;
  context.drawImage(
    image,
    base.x - width / 2,
    base.y - height + 6,
    width,
    height,
  );
}

// Half the house's width and depth, in tiles.
const HOUSE_HALF =
  HOUSE.footprint?.kind === "box" ? HOUSE.footprint.halfWidth : 1.5;

/**
 * Draws the player's house: cream walls, a red hip roof, a door facing the yard, and windows.
 * @param context - The canvas.
 * @param x - The middle of the house on the screen, in tiles.
 * @param y - The middle of the house on the screen, in tiles.
 */
function drawHouse(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  const half = HOUSE_HALF;
  const wall = 62;
  const at = (dx: number, dy: number, height = 0) =>
    project(x + dx, y + dy, height);
  // The ground corners of the two walls that face the viewer.
  const right = at(half, -half);
  const front = at(half, half);
  const left = at(-half, half);
  const up = (point: Point, height: number) => ({
    x: point.x,
    y: point.y - height,
  });
  drawShadow(context, { x: front.x, y: front.y - 8 }, 110, 34);

  context.lineJoin = "round";
  context.strokeStyle = "#3b2a1e";
  context.lineWidth = 2;
  // The two walls that face the viewer.
  polygon(context, [left, front, up(front, wall), up(left, wall)]);
  context.fillStyle = "#f3e4c4";
  context.fill();
  context.stroke();
  polygon(context, [front, right, up(right, wall), up(front, wall)]);
  context.fillStyle = "#dcc69c";
  context.fill();
  context.stroke();

  // The door, in the middle of the left-front wall.
  polygon(context, [
    at(-0.35, half),
    at(0.35, half),
    at(0.35, half, 36),
    at(-0.35, half, 36),
  ]);
  context.fillStyle = "#7a4a2a";
  context.fill();
  context.stroke();
  const knob = at(0.2, half, 17);
  context.fillStyle = "#f2c94c";
  context.beginPath();
  context.arc(knob.x, knob.y, 2, 0, Math.PI * 2);
  context.fill();

  // Windows: one beside the door, two on the right-front wall.
  const windows: Point[][] = [
    [
      at(-1.25, half, 24),
      at(-0.7, half, 24),
      at(-0.7, half, 44),
      at(-1.25, half, 44),
    ],
    [
      at(half, -1.0, 24),
      at(half, -0.35, 24),
      at(half, -0.35, 44),
      at(half, -1.0, 44),
    ],
    [
      at(half, 0.35, 24),
      at(half, 1.0, 24),
      at(half, 1.0, 44),
      at(half, 0.35, 44),
    ],
  ];
  for (const corners of windows) {
    polygon(context, corners);
    context.fillStyle = "#a8d8f0";
    context.fill();
    context.stroke();
  }

  // A hip roof: four slopes rising from the eaves to a point above the middle of the house.
  const eave = half + 0.3;
  const apex = at(0, 0, wall + 58);
  const eaves = {
    back: at(-eave, -eave, wall),
    right: at(eave, -eave, wall),
    front: at(eave, eave, wall),
    left: at(-eave, eave, wall),
  };
  const slopes: [Point, Point, string][] = [
    [eaves.back, eaves.right, "#a8432f"],
    [eaves.left, eaves.back, "#b44a34"],
    [eaves.right, eaves.front, "#9c3d2b"],
    [eaves.front, eaves.left, "#c4553f"],
  ];
  for (const [from, to, colour] of slopes) {
    polygon(context, [from, to, apex]);
    context.fillStyle = colour;
    context.fill();
    context.stroke();
  }
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
  const base = project(x, y);
  const pulse = 0.5 + 0.5 * Math.sin(time * 3 + spawn.id);
  const glow = context.createRadialGradient(
    base.x,
    base.y,
    2,
    base.x,
    base.y,
    34,
  );
  glow.addColorStop(0, `rgb(255 214 77 / ${0.55 + pulse * 0.3})`);
  glow.addColorStop(1, "rgb(255 214 77 / 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.ellipse(base.x, base.y, 34, 15, 0, 0, Math.PI * 2);
  context.fill();

  const radius = 24;
  const centre = {
    x: base.x,
    y: base.y - 44 - Math.sin(time * 2.4 + spawn.id) * 4,
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
      centre.x + Math.cos(angle) * 34,
      centre.y + Math.sin(angle) * 14,
    );
  }

  // Their name on a dark tag above the token.
  const label = `★ ${spawn.name}`;
  context.font = "bold 11px 'Segoe UI', Arial, sans-serif";
  const width = context.measureText(label).width + 14;
  context.fillStyle = "rgb(37 75 63 / 0.92)";
  context.beginPath();
  context.roundRect(centre.x - width / 2, centre.y - radius - 26, width, 18, 9);
  context.fill();
  context.fillStyle = "#ffe08a";
  context.fillText(label, centre.x, centre.y - radius - 16);
}

/**
 * Draws the player: a small student in a green jacket and lime cap, facing the way they walk,
 * with legs that swing while walking.
 * @param context - The canvas.
 * @param at - Their position on the screen, in tiles.
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
  const base = project(at.x, at.y);
  const swing = walking ? Math.sin(time * 12) : 0;
  const bob = walking ? Math.abs(swing) * 2.5 : 0;
  const away = facing.startsWith("n");
  const side = facing.endsWith("e") ? 1 : facing.endsWith("w") ? -1 : 0;
  drawShadow(context, base, 13, 5);

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
