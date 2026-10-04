/**
 * Rules for the rooms inside the buildings: the player's home and the school. Each room is one
 * screen of SCREEN_TILES × SCREEN_TILES tiles, seen from straight above like the campus, with
 * a wall along the top, thin walls down the sides and along the bottom, and a door in the
 * middle of the bottom wall. Nothing here touches the DOM, so it runs (and is tested) in Node.
 */
// The rule tests run this file directly in Node, which needs the ".ts" on local imports.
import {
  DIRECTION_VECTORS,
  PLAYER_RADIUS,
  SCREEN_TILES,
  WALK_SPEED,
} from "./world.ts";
import type { Building, Direction, Point } from "./world.ts";

/** Where the player can be: out on the campus, or inside a building. */
export type Place = "campus" | Building;

/** The pictures a room's furniture uses. */
export type RoomArt =
  | "bed"
  | "nightstand"
  | "bookshelf"
  | "sofa"
  | "tv"
  | "desk"
  | "fridge"
  | "plant"
  | "window"
  | "blackboard"
  | "studentDesk"
  | "machine";

/**
 * One piece of furniture. Its x is its middle and its y is where its base touches the floor,
 * both in tiles from the room's top-left corner. `height` is how tall it is drawn, in tiles.
 * `block` is the floor it takes up: this far to either side of x, and this far back from y.
 * Things hung on the wall (windows, the blackboard) have no block.
 */
export type RoomItem = {
  art: RoomArt;
  x: number;
  y: number;
  height: number;
  block: { halfWidth: number; depth: number } | null;
};

/** A room: its floor, its furniture, and anything the player can use in it. */
export type Room = {
  id: Building;
  floor: "wood" | "tile";
  items: readonly RoomItem[];
  // The gashapon machine's front, where the player stands to use it, if the room has one.
  machine: Point | null;
  // Someone standing in the room that the player can talk to, if there is anyone.
  npc: (Point & { look: string; name: string }) | null;
};
/** How much floor someone standing in a room takes up: the radius of their circle, in tiles. */
export const NPC_RADIUS = 0.35;

/** How thick the walls are, in tiles. The top wall is seen face-on, so it is the tallest. */
export const WALLS = { top: 1.6, side: 0.25, bottom: 0.25 };
/** The door, in the middle of the bottom wall, and how wide it is. */
export const ROOM_DOOR: Point = {
  x: SCREEN_TILES / 2,
  y: SCREEN_TILES - WALLS.bottom,
};
export const ROOM_DOOR_WIDTH = 1.4;
/** Where the player stands after walking in: just inside the door. */
export const ROOM_ENTRY: Point = { x: ROOM_DOOR.x, y: ROOM_DOOR.y - 0.7 };
/** How close the player must be to the door or the gashapon machine to use it, in tiles. */
export const ROOM_REACH = 1.1;

const item = (
  art: RoomArt,
  x: number,
  y: number,
  height: number,
  block: RoomItem["block"] = null,
): RoomItem => ({ art, x, y, height, block });
// Furniture standing against the top wall blocks all the way back to it, so the player
// cannot squeeze in behind.
const againstWall = (y: number) => y - WALLS.top;

/** The player's home: a bedroom and living room in one. */
export const HOME_ROOM: Room = {
  id: "home",
  floor: "wood",
  machine: null,
  npc: null,
  items: [
    item("window", 3.4, 1.35, 1.0),
    item("window", 8.6, 1.35, 1.0),
    item("nightstand", 0.9, 3.0, 1.3, {
      halfWidth: 0.45,
      depth: againstWall(3.0),
    }),
    item("bed", 2.3, 3.7, 2.3, { halfWidth: 0.85, depth: againstWall(3.7) }),
    item("bookshelf", 5.6, 3.0, 1.9, {
      halfWidth: 0.65,
      depth: againstWall(3.0),
    }),
    item("desk", 8.4, 2.9, 1.25, { halfWidth: 0.85, depth: againstWall(2.9) }),
    item("fridge", 10.9, 3.1, 2.0, { halfWidth: 0.5, depth: againstWall(3.1) }),
    item("sofa", 2.4, 8.3, 1.4, { halfWidth: 0.95, depth: 0.7 }),
    item("tv", 2.4, 10.9, 1.5, { halfWidth: 0.75, depth: 0.6 }),
    item("plant", 11.0, 11.0, 1.0, { halfWidth: 0.35, depth: 0.4 }),
    item("plant", 9.4, 11.0, 1.0, { halfWidth: 0.35, depth: 0.4 }),
  ],
};

/** The school: a classroom with a blackboard, rows of desks, and the gashapon machine. */
export const SCHOOL_ROOM: Room = {
  id: "school",
  floor: "tile",
  machine: { x: 10.4, y: 4.1 },
  // The teacher stands in front of the blackboard and gives quizzes for tokens.
  npc: { x: 5.6, y: 2.8, look: "chao-liu", name: "Teacher" },
  items: [
    item("window", 1.9, 1.35, 1.0),
    item("blackboard", 5.6, 1.5, 1.3),
    item("bookshelf", 0.95, 3.0, 1.9, {
      halfWidth: 0.65,
      depth: againstWall(3.0),
    }),
    item("desk", 3.2, 3.3, 1.25, { halfWidth: 0.85, depth: 0.6 }),
    item("machine", 10.4, 3.6, 2.5, {
      halfWidth: 0.55,
      depth: againstWall(3.6),
    }),
    ...[5.6, 7.5, 9.4].flatMap((y) =>
      [2.2, 5.0, 7.8].map((x) =>
        item("studentDesk", x, y, 1.0, { halfWidth: 0.6, depth: 0.5 }),
      ),
    ),
    item("plant", 1.0, 11.0, 1.0, { halfWidth: 0.35, depth: 0.4 }),
    item("plant", 11.0, 11.0, 1.0, { halfWidth: 0.35, depth: 0.4 }),
  ],
};

/** The room inside each building. */
export const ROOMS: Readonly<Record<Building, Room>> = {
  home: HOME_ROOM,
  school: SCHOOL_ROOM,
};

/**
 * Checks whether a circle at a point would overlap a wall or a piece of furniture.
 * @param room - The room.
 * @param point - The circle's centre, in tiles from the room's top-left corner.
 * @param radius - The circle's radius. Defaults to the player's.
 * @returns True if the space is blocked.
 */
export function isRoomBlocked(
  room: Room,
  point: Point,
  radius = PLAYER_RADIUS,
): boolean {
  if (
    point.x - radius < WALLS.side ||
    point.x + radius > SCREEN_TILES - WALLS.side ||
    point.y - radius < WALLS.top ||
    point.y + radius > SCREEN_TILES - WALLS.bottom
  )
    return true;
  if (
    room.npc &&
    Math.hypot(point.x - room.npc.x, point.y - room.npc.y) < NPC_RADIUS + radius
  )
    return true;
  return room.items.some(
    ({ x, y, block }) =>
      block &&
      Math.abs(point.x - x) < block.halfWidth + radius &&
      point.y > y - block.depth - radius &&
      point.y < y + radius,
  );
}

/**
 * Moves the player one step inside a room. They walk at the same speed as on the campus and
 * slide along walls and furniture they bump into.
 * @param room - The room.
 * @param from - Where the player is.
 * @param direction - Which way they are walking.
 * @param seconds - How long the step lasts.
 * @returns Where the player ends up. It is `from` if every way forward is blocked.
 */
export function walkRoom(
  room: Room,
  from: Point,
  direction: Direction,
  seconds: number,
): Point {
  const vector = DIRECTION_VECTORS[direction];
  const dx = vector.x * WALK_SPEED * seconds;
  const dy = vector.y * WALK_SPEED * seconds;
  for (const [stepX, stepY] of [
    [dx, dy],
    [dx, 0],
    [0, dy],
  ]) {
    if (stepX === 0 && stepY === 0) continue;
    const next = { x: from.x + stepX, y: from.y + stepY };
    if (!isRoomBlocked(room, next)) return next;
  }
  return from;
}

/** What the player can use from where they stand in a room. */
export type RoomUse = "exit" | "machine" | "teacher";

/**
 * Finds what the player can use from where they stand: the door out, the gashapon machine,
 * or the teacher.
 * @param room - The room.
 * @param point - Where the player is.
 * @returns What is in reach, or null.
 */
export function roomUseAt(room: Room, point: Point): RoomUse | null {
  const near = (target: Point) =>
    Math.hypot(point.x - target.x, point.y - target.y) < ROOM_REACH;
  if (room.machine && near(room.machine)) return "machine";
  if (room.npc && near(room.npc)) return "teacher";
  return near(ROOM_DOOR) ? "exit" : null;
}

/**
 * Picks a place in a room for a wild professor to appear: open floor with room around it,
 * away from the door and from the player.
 * @param room - The room.
 * @param player - Where the player is, if they are in this room.
 * @param random - A random number generator, such as Math.random.
 * @returns The place, or null if no open place was found after many tries.
 */
export function pickRoomSpawnPoint(
  room: Room,
  player: Point | null,
  random: () => number,
): Point | null {
  for (let attempt = 0; attempt < 100; attempt++) {
    const point = {
      x: 1 + random() * (SCREEN_TILES - 2),
      y: WALLS.top + 1 + random() * (SCREEN_TILES - WALLS.top - 2.5),
    };
    if (isRoomBlocked(room, point, 0.6)) continue;
    if (Math.hypot(point.x - ROOM_DOOR.x, point.y - ROOM_DOOR.y) < 2.5)
      continue;
    if (player && Math.hypot(point.x - player.x, point.y - player.y) < 4)
      continue;
    return point;
  }
  return null;
}
