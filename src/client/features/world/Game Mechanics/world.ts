/**
 * Rules for the open-world campus map: its layout, walking, wrapping, collisions, and where
 * Legendary professors appear. Nothing here touches the DOM, so it runs (and is tested) in Node.
 *
 * The map is seen from straight above. Coordinates are in tiles: x grows to the right and y
 * grows down the screen. The world is WORLD_SCREENS × WORLD_SCREENS screens, and each screen
 * is SCREEN_TILES × SCREEN_TILES tiles, so x and y both run from 0 up to (not including)
 * WORLD_TILES. Walking off one screen puts the player on the opposite edge of the next screen,
 * and walking off the edge of the world wraps around to the opposite side.
 */

/** Screens across and down the world: a 5 × 5 map. */
export const WORLD_SCREENS = 5;
/** Tiles across and down one screen. */
export const SCREEN_TILES = 12;
/** Tiles across and down the whole world. */
export const WORLD_TILES = WORLD_SCREENS * SCREEN_TILES;
/** The screen in the middle of the map, where the player's house is. */
export const HOME_SCREEN: Screen = { col: 2, row: 2 };
/** How far the player walks each second, in tiles. */
export const WALK_SPEED = 3.2;
/** The player's size for collisions: the radius of the circle they stand on, in tiles. */
export const PLAYER_RADIUS = 0.28;
/** How close the player must get to a Legendary professor to meet them, in tiles. */
export const ENCOUNTER_RADIUS = 0.85;

/** A position in the world, in tiles. */
export type Point = { x: number; y: number };
/** One screen of the map, counted from 0 at the top-left corner. */
export type Screen = { col: number; row: number };

/**
 * The eight directions the player can walk, named by where they go on the screen:
 * "n" is straight up the screen, "ne" is up and to the right, and so on.
 */
export type Direction = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
/** Which movement keys (or on-screen buttons) are held down. */
export type MoveInput = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

// The map is seen from straight above: x grows to the right and y grows down the screen.
// Each vector is one tile long, so diagonals are no faster than straight lines.
const HALF_ROOT_TWO = Math.SQRT1_2;
export const DIRECTION_VECTORS: Readonly<Record<Direction, Point>> = {
  n: { x: 0, y: -1 },
  ne: { x: HALF_ROOT_TWO, y: -HALF_ROOT_TWO },
  e: { x: 1, y: 0 },
  se: { x: HALF_ROOT_TWO, y: HALF_ROOT_TWO },
  s: { x: 0, y: 1 },
  sw: { x: -HALF_ROOT_TWO, y: HALF_ROOT_TWO },
  w: { x: -1, y: 0 },
  nw: { x: -HALF_ROOT_TWO, y: -HALF_ROOT_TWO },
};

/**
 * Works out which way the player walks from the keys they hold. Opposite keys cancel out,
 * and two neighbouring keys (such as up and right) give a diagonal.
 * @param input - The movement keys held down.
 * @returns The direction, or null when the player should stand still.
 */
export function directionFor(input: MoveInput): Direction | null {
  const vertical = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const horizontal = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const name =
    (vertical < 0 ? "n" : vertical > 0 ? "s" : "") +
    (horizontal > 0 ? "e" : horizontal < 0 ? "w" : "");
  return name ? (name as Direction) : null;
}

/**
 * Wraps a coordinate onto the world, so walking off one side comes back on the other.
 * @param value - A coordinate in tiles, possibly outside the world.
 * @returns The same place, from 0 up to (not including) WORLD_TILES.
 */
export function wrap(value: number): number {
  return ((value % WORLD_TILES) + WORLD_TILES) % WORLD_TILES;
}

/**
 * Finds the screen a point is on.
 * @param point - A position in the world.
 * @returns The screen holding it.
 */
export function screenOf(point: Point): Screen {
  return {
    col: Math.floor(wrap(point.x) / SCREEN_TILES),
    row: Math.floor(wrap(point.y) / SCREEN_TILES),
  };
}

/**
 * Names a screen like a map grid square: columns A–E and rows 1–5, so the home screen is "C3".
 * @param screen - The screen.
 * @returns Its name.
 */
export function screenName(screen: Screen): string {
  return `${String.fromCharCode(65 + screen.col)}${screen.row + 1}`;
}

/**
 * Finds the shortest way from one point to another, allowing for the world wrapping around.
 * @param from - The starting point.
 * @param to - The end point.
 * @returns The x and y steps to take, each between -WORLD_TILES / 2 and WORLD_TILES / 2.
 */
export function wrappedOffset(from: Point, to: Point): Point {
  const half = WORLD_TILES / 2;
  const step = (a: number, b: number) => wrap(b - a + half) - half;
  return { x: step(from.x, to.x), y: step(from.y, to.y) };
}

/**
 * Measures the distance between two points, allowing for the world wrapping around.
 * @param a - One point.
 * @param b - The other point.
 * @returns The distance in tiles.
 */
export function wrappedDistance(a: Point, b: Point): number {
  const { x, y } = wrappedOffset(a, b);
  return Math.hypot(x, y);
}

// ---------------------------------------------------------------- What is on the map

/** The kinds of scenery on the map. */
export type PropKind =
  | "oak"
  | "pine"
  | "bush"
  | "rock"
  | "flowers"
  | "mailbox"
  | "house"
  | "school";

/** The space a piece of scenery blocks: a circle, or (for a building) a rectangle. */
export type Footprint =
  | { kind: "circle"; radius: number }
  | { kind: "box"; halfWidth: number; halfDepth: number };

/**
 * One piece of scenery. Its x and y are where its base touches the ground (for a tree, the
 * bottom of its trunk), and it is drawn standing upright from there.
 */
export type Prop = {
  kind: PropKind;
  x: number;
  y: number;
  // The space it blocks, or null if the player can walk through it (like flowers).
  footprint: Footprint | null;
};

// How much ground each blocking kind of scenery takes up, in tiles. For trees this is only
// the trunk: the leaves and branches hang overhead, so the player can walk under them.
const PROP_RADIUS: Partial<Record<PropKind, number>> = {
  oak: 0.2,
  pine: 0.18,
  bush: 0.4,
  rock: 0.35,
  mailbox: 0.2,
};

/** The trees, whose leaves and branches the player can walk under. */
export const TREE_KINDS: readonly PropKind[] = ["oak", "pine"];
/**
 * The area a tree's leaves and branches cover, in tiles: this far to either side of the trunk,
 * and from the trunk's base this far up the screen. The renderer draws trees this size.
 */
export const CANOPY = { halfWidth: 1, height: 2.3 };

/**
 * Checks whether a point is under a tree's leaves, where the tree is drawn over anything there.
 * @param map - The map.
 * @param point - The point (already wrapped onto the world).
 * @returns True if a tree's canopy hangs over the point.
 */
export function isUnderCanopy(map: WorldMap, point: Point): boolean {
  return map
    .propsOn(screenOf(point))
    .some(
      (prop) =>
        TREE_KINDS.includes(prop.kind) &&
        Math.abs(point.x - prop.x) < CANOPY.halfWidth &&
        point.y < prop.y &&
        prop.y - point.y < CANOPY.height,
    );
}
// The chance of each blocking kind when filling a screen. They add up to 1.
const SCENERY_MIX: readonly [PropKind, number][] = [
  ["oak", 0.35],
  ["pine", 0.25],
  ["bush", 0.2],
  ["rock", 0.2],
];
// Blocking scenery is kept at least this far apart, so the player can always squeeze between.
const PROP_SPACING = 1.6;
// Changing this number gives a different (but still fixed) map.
const WORLD_SEED = 20261004;

/** The player's house, in the middle of the home screen. */
export const HOUSE: Prop = {
  kind: "house",
  x: HOME_SCREEN.col * SCREEN_TILES + SCREEN_TILES / 2,
  y: HOME_SCREEN.row * SCREEN_TILES + SCREEN_TILES / 2,
  footprint: { kind: "box", halfWidth: 1.5, halfDepth: 1.5 },
};
/** Where the player starts: on the doorstep, just in front of the house door. */
export const START: Point = { x: HOUSE.x, y: HOUSE.y + 2.6 };
/** The screen with the school: the one to the right of home. */
export const SCHOOL_SCREEN: Screen = { col: 3, row: 2 };
/** The school, in the middle of its screen. It is wider than the house. */
export const SCHOOL: Prop = {
  kind: "school",
  x: SCHOOL_SCREEN.col * SCREEN_TILES + SCREEN_TILES / 2,
  y: SCHOOL_SCREEN.row * SCREEN_TILES + SCREEN_TILES / 2,
  footprint: { kind: "box", halfWidth: 2.5, halfDepth: 1.5 },
};

/** The buildings the player can go into. */
export type Building = "home" | "school";
/** Each building's door: the middle of its front wall, which faces down the screen. */
export const DOORS: Readonly<Record<Building, Point>> = {
  home: { x: HOUSE.x, y: HOUSE.y + 1.5 },
  school: { x: SCHOOL.x, y: SCHOOL.y + 1.5 },
};
/** How close to a door the player must stand to go in, in tiles. */
export const DOOR_REACH = 1.2;

/**
 * Finds the building whose door the player is standing at.
 * @param point - Where the player is.
 * @returns The building, or null if they are not in front of a door.
 */
export function doorAt(point: Point): Building | null {
  for (const building of ["home", "school"] as const) {
    const door = DOORS[building];
    if (point.y > door.y && wrappedDistance(point, door) < DOOR_REACH)
      return building;
  }
  return null;
}

/**
 * Finds where the player stands after walking out of a building: on its doorstep.
 * @param building - The building they left.
 * @returns The spot just in front of its door.
 */
export function doorstep(building: Building): Point {
  return { x: DOORS[building].x, y: DOORS[building].y + 0.9 };
}

/**
 * Makes a random number generator that always gives the same numbers for the same seed
 * (mulberry32). The map is built from it, so every player sees the same map on every visit.
 * @param seed - Any whole number.
 * @returns A function like Math.random.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Checks whether a screen is the home screen.
 * @param screen - The screen.
 * @returns True for the screen with the player's house.
 */
export function isHome(screen: Screen): boolean {
  return screen.col === HOME_SCREEN.col && screen.row === HOME_SCREEN.row;
}

/**
 * Checks whether a screen is the one with the school.
 * @param screen - The screen.
 * @returns True for the school's screen.
 */
export function isSchoolScreen(screen: Screen): boolean {
  return screen.col === SCHOOL_SCREEN.col && screen.row === SCHOOL_SCREEN.row;
}

/**
 * Lays out the scenery on one screen. The layout is the same every time for the same screen.
 * Blocking scenery stays off the outer ring of tiles, so the player can always cross into the
 * next screen, and keeps PROP_SPACING apart. The home screen has the house, a mailbox, and a
 * clear yard around them; the school's screen has the school and a clear yard around it.
 * @param screen - The screen to lay out.
 * @returns Its scenery, in world coordinates.
 */
export function buildScreen(screen: Screen): Prop[] {
  const random = seededRandom(
    WORLD_SEED + screen.col * 7919 + screen.row * 104729,
  );
  const home = isHome(screen);
  // The building on this screen, if it has one.
  const building = home ? HOUSE : isSchoolScreen(screen) ? SCHOOL : null;
  const left = screen.col * SCREEN_TILES;
  const top = screen.row * SCREEN_TILES;
  const props: Prop[] = home
    ? [
        HOUSE,
        // The mailbox stands against the front wall beside the door, so there is no narrow
        // gap behind it to get stuck in and it is out of the way of the doorstep.
        {
          kind: "mailbox",
          x: HOUSE.x + 1.3,
          y: HOUSE.y + 1.85,
          footprint: { kind: "circle", radius: PROP_RADIUS.mailbox! },
        },
      ]
    : building
      ? [building]
      : [];
  // Keeps the yard around the building and its doorstep clear, including of overhanging leaves.
  const yard = {
    x: building?.x ?? 0,
    y: (building?.y ?? 0) + 0.8,
    radius: home ? 3.6 : 4.6,
  };
  const inYard = (x: number, y: number, kind: PropKind) => {
    if (!building) return false;
    // For a tree, the nearest point of its canopy to the middle of the yard.
    const tree = TREE_KINDS.includes(kind);
    const nearestX = tree
      ? Math.max(x - CANOPY.halfWidth, Math.min(yard.x, x + CANOPY.halfWidth))
      : x;
    const nearestY = tree
      ? Math.max(y - CANOPY.height, Math.min(yard.y, y))
      : y;
    return Math.hypot(nearestX - yard.x, nearestY - yard.y) < yard.radius;
  };
  const solids = building
    ? 6 + Math.floor(random() * 3)
    : 9 + Math.floor(random() * 6);
  for (
    let attempt = 0;
    attempt < 200 && countSolid(props) < solids + (home ? 2 : building ? 1 : 0);
    attempt++
  ) {
    // Tile centres from the second tile to the second-to-last, so the edges stay walkable.
    const x = left + 1.5 + Math.floor(random() * (SCREEN_TILES - 2));
    const y = top + 1.5 + Math.floor(random() * (SCREEN_TILES - 2));
    const kind = pickKind(random());
    if (inYard(x, y, kind)) continue;
    if (
      props.some(
        (prop) =>
          prop.footprint && Math.hypot(prop.x - x, prop.y - y) < PROP_SPACING,
      )
    )
      continue;
    props.push({
      kind,
      x,
      y,
      footprint: { kind: "circle", radius: PROP_RADIUS[kind]! },
    });
  }
  // Flowers do not block anything, so they can go anywhere that is not already taken.
  const flowers = building ? 4 : 2 + Math.floor(random() * 4);
  for (
    let placed = 0, attempt = 0;
    placed < flowers && attempt < 100;
    attempt++
  ) {
    const x = left + 0.5 + Math.floor(random() * SCREEN_TILES);
    const y = top + 0.5 + Math.floor(random() * SCREEN_TILES);
    if (
      building &&
      Math.abs(x - building.x) < 3 &&
      Math.abs(y - building.y) < 2
    )
      continue;
    if (props.some((prop) => Math.hypot(prop.x - x, prop.y - y) < 1)) continue;
    props.push({ kind: "flowers", x, y, footprint: null });
    placed++;
  }
  return props;
}

/**
 * Counts the scenery that blocks the player.
 * @param props - Some scenery.
 * @returns How many of them block.
 */
function countSolid(props: readonly Prop[]): number {
  return props.filter((prop) => prop.footprint).length;
}

/**
 * Picks a kind of blocking scenery from SCENERY_MIX.
 * @param roll - A random number from 0 to 1.
 * @returns The kind.
 */
function pickKind(roll: number): PropKind {
  for (const [kind, chance] of SCENERY_MIX) {
    if (roll < chance) return kind;
    roll -= chance;
  }
  return SCENERY_MIX[SCENERY_MIX.length - 1][0];
}

/** The whole map: every screen's scenery, built once and then reused. */
export type WorldMap = { propsOn(screen: Screen): readonly Prop[] };

/**
 * Creates the map. Screens are built the first time they are needed.
 * @returns The map.
 */
export function createWorldMap(): WorldMap {
  const screens = new Map<string, Prop[]>();
  return {
    propsOn(screen) {
      const key = `${screen.col},${screen.row}`;
      let props = screens.get(key);
      if (!props) {
        props = buildScreen(screen);
        screens.set(key, props);
      }
      return props;
    },
  };
}

// ---------------------------------------------------------------- Walking

/**
 * Checks whether a circle of the given radius overlaps a piece of scenery.
 * @param point - The circle's centre.
 * @param radius - The circle's radius, in tiles.
 * @param prop - The scenery.
 * @returns True if they overlap. Scenery that does not block never overlaps.
 */
function overlaps(point: Point, radius: number, prop: Prop): boolean {
  const footprint = prop.footprint;
  if (!footprint) return false;
  if (footprint.kind === "circle") {
    return (
      Math.hypot(point.x - prop.x, point.y - prop.y) < footprint.radius + radius
    );
  }
  // The nearest point of the rectangle to the circle's centre.
  const nearestX = Math.max(
    prop.x - footprint.halfWidth,
    Math.min(point.x, prop.x + footprint.halfWidth),
  );
  const nearestY = Math.max(
    prop.y - footprint.halfDepth,
    Math.min(point.y, prop.y + footprint.halfDepth),
  );
  return Math.hypot(point.x - nearestX, point.y - nearestY) < radius;
}

/**
 * Checks whether a circle at a point would overlap any blocking scenery.
 * Scenery never reaches the outer ring of tiles, so only the point's own screen needs checking.
 * @param map - The map.
 * @param point - The circle's centre (already wrapped onto the world).
 * @param radius - The circle's radius. Defaults to the player's.
 * @returns True if the space is blocked.
 */
export function isBlocked(
  map: WorldMap,
  point: Point,
  radius = PLAYER_RADIUS,
): boolean {
  return map
    .propsOn(screenOf(point))
    .some((prop) => overlaps(point, radius, prop));
}

/**
 * Moves the player one step. They walk WALK_SPEED tiles a second in the given direction, slide
 * along scenery they bump into, and wrap around the edges of the world.
 * @param map - The map.
 * @param from - Where the player is.
 * @param direction - Which way they are walking.
 * @param seconds - How long the step lasts.
 * @returns Where the player ends up. It is `from` if every way forward is blocked.
 */
export function walk(
  map: WorldMap,
  from: Point,
  direction: Direction,
  seconds: number,
): Point {
  const vector = DIRECTION_VECTORS[direction];
  const distance = WALK_SPEED * seconds;
  const dx = vector.x * distance;
  const dy = vector.y * distance;
  // Try the full step, then just its x part, then just its y part, so the player slides
  // along a tree instead of stopping dead when walking diagonally into it.
  for (const [stepX, stepY] of [
    [dx, dy],
    [dx, 0],
    [0, dy],
  ]) {
    if (stepX === 0 && stepY === 0) continue;
    const next = { x: wrap(from.x + stepX), y: wrap(from.y + stepY) };
    if (!isBlocked(map, next)) return next;
  }
  return from;
}

// ---------------------------------------------------------------- Legendary professors

/** Timing and limits for Legendary professors appearing on the map, in seconds. */
export const SPAWNING = {
  // The first one appears this soon after the map opens.
  firstDelay: 1,
  // After that, a new one appears every minDelay to maxDelay seconds.
  minDelay: 5,
  maxDelay: 12,
  // Each one leaves after this long if nobody meets them.
  lifetime: 90,
  // No more than this many at once.
  maxActive: 6,
  // They appear at least this far from the player, in tiles: close enough to turn up on
  // the player's own screen, but never right on top of them.
  minDistance: 5,
  // ...and no further than this, so there is usually one roaming somewhere in sight.
  maxDistance: 16,
};

/** A Legendary professor waiting somewhere on the map. */
export type Spawn = {
  id: number;
  professorId: string;
  x: number;
  y: number;
  // When they leave, in seconds on the game clock.
  leavesAt: number;
};

/**
 * Picks a place for a Legendary professor to appear: an open tile, away from the scenery and
 * the screen edges, between SPAWNING.minDistance and SPAWNING.maxDistance from the player, and
 * never on the home screen.
 * @param map - The map.
 * @param player - Where the player is.
 * @param random - A random number generator, such as Math.random.
 * @returns The place, or null if no open place was found after many tries.
 */
export function pickSpawnPoint(
  map: WorldMap,
  player: Point,
  random: () => number,
): Point | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    const screen = {
      col: Math.floor(random() * WORLD_SCREENS),
      row: Math.floor(random() * WORLD_SCREENS),
    };
    if (isHome(screen)) continue;
    const point = {
      x:
        screen.col * SCREEN_TILES +
        1.5 +
        Math.floor(random() * (SCREEN_TILES - 2)),
      y:
        screen.row * SCREEN_TILES +
        1.5 +
        Math.floor(random() * (SCREEN_TILES - 2)),
    };
    const distance = wrappedDistance(point, player);
    if (distance < SPAWNING.minDistance || distance > SPAWNING.maxDistance)
      continue;
    // Leave room around them, and keep them out from under the trees, where they'd be hidden.
    if (isBlocked(map, point, 0.6) || isUnderCanopy(map, point)) continue;
    return point;
  }
  return null;
}

/**
 * Finds a Legendary professor the player is close enough to meet.
 * @param player - Where the player is.
 * @param spawns - The professors on the map.
 * @returns The first one within ENCOUNTER_RADIUS, or undefined.
 */
export function findEncounter(
  player: Point,
  spawns: readonly Spawn[],
): Spawn | undefined {
  return spawns.find(
    (spawn) => wrappedDistance(player, spawn) < ENCOUNTER_RADIUS,
  );
}
