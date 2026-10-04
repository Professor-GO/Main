/** Rules for the campus map: screens, wrapping, walking, collisions, and Legendary spawns. */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DIRECTION_VECTORS,
  ENCOUNTER_RADIUS,
  HOME_SCREEN,
  HOUSE,
  PLAYER_RADIUS,
  SCREEN_TILES,
  SPAWNING,
  START,
  WALK_SPEED,
  WORLD_SCREENS,
  WORLD_TILES,
  buildScreen,
  createWorldMap,
  directionFor,
  findEncounter,
  isBlocked,
  pickSpawnPoint,
  screenName,
  screenOf,
  seededRandom,
  walk,
  wrap,
  wrappedDistance,
} from "../world.ts";
import type { Direction, Point, Screen, WorldMap } from "../world.ts";

// A map with no scenery at all, for testing walking on its own.
const OPEN_MAP: WorldMap = { propsOn: () => [] };
const ALL_SCREENS: Screen[] = Array.from(
  { length: WORLD_SCREENS * WORLD_SCREENS },
  (_, index) => ({
    col: index % WORLD_SCREENS,
    row: Math.floor(index / WORLD_SCREENS),
  }),
);

/**
 * Walks in one direction for a while, in small steps like the game loop takes.
 * @param map - The map.
 * @param from - Where to start.
 * @param direction - Which way to walk.
 * @param seconds - How long to walk.
 * @returns Where the walk ends.
 */
function walkFor(
  map: WorldMap,
  from: Point,
  direction: Direction,
  seconds: number,
): Point {
  let at = from;
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 0.02)
    at = walk(map, at, direction, 0.02);
  return at;
}

test("the world is 5 × 5 screens, and the player starts at home in the middle", () => {
  assert.equal(WORLD_SCREENS, 5);
  assert.deepEqual(HOME_SCREEN, { col: 2, row: 2 });
  assert.deepEqual(screenOf(START), HOME_SCREEN);
  assert.deepEqual(screenOf(HOUSE), HOME_SCREEN);
  assert.equal(screenName(HOME_SCREEN), "C3");
  assert.equal(screenName({ col: 0, row: 0 }), "A1");
  assert.equal(screenName({ col: 4, row: 4 }), "E5");
  // The player starts on their doorstep, not inside a wall or the mailbox.
  assert.equal(isBlocked(createWorldMap(), START), false);
});

test("eight directions: each key or pair of keys walks a different way, all at the same speed", () => {
  const press = (keys: string) => ({
    up: keys.includes("u"),
    down: keys.includes("d"),
    left: keys.includes("l"),
    right: keys.includes("r"),
  });
  assert.equal(directionFor(press("")), null);
  assert.equal(directionFor(press("ud")), null);
  assert.equal(directionFor(press("lr")), null);
  assert.deepEqual(
    ["u", "ur", "r", "dr", "d", "dl", "l", "ul"].map((keys) =>
      directionFor(press(keys)),
    ),
    ["n", "ne", "e", "se", "s", "sw", "w", "nw"],
  );
  // Up, left, and right together is just up.
  assert.equal(directionFor(press("ulr")), "n");
  const vectors = Object.values(DIRECTION_VECTORS);
  assert.equal(
    new Set(
      vectors.map((vector) => `${vector.x.toFixed(3)},${vector.y.toFixed(3)}`),
    ).size,
    8,
  );
  for (const vector of vectors)
    assert.ok(Math.abs(Math.hypot(vector.x, vector.y) - 1) < 1e-12);
  const step = walk(OPEN_MAP, { x: 30, y: 30 }, "ne", 1);
  assert.ok(
    Math.abs(wrappedDistance({ x: 30, y: 30 }, step) - WALK_SPEED) < 1e-9,
  );
});

test("walking off the edge of a screen arrives at the opposite edge of the next screen", () => {
  // Start near the south-east edge of the home screen (x close to the end of column C).
  const nearEdge = { x: 3 * SCREEN_TILES - 0.1, y: 30 };
  const across = walkFor(OPEN_MAP, nearEdge, "se", 0.1);
  assert.deepEqual(screenOf(nearEdge), HOME_SCREEN);
  assert.deepEqual(screenOf(across), { col: 3, row: 2 });
  // It lands just inside the next screen's opposite (north-west) edge.
  assert.ok(across.x - 3 * SCREEN_TILES < 0.5);
  // And straight back again.
  assert.deepEqual(screenOf(walkFor(OPEN_MAP, across, "nw", 0.2)), HOME_SCREEN);
});

test("walking off the edge of the whole map wraps around to the opposite side", () => {
  assert.equal(wrap(-0.5), WORLD_TILES - 0.5);
  assert.equal(wrap(WORLD_TILES + 1), 1);
  // Off the north-west edge of column A, onto column E.
  const west = walkFor(OPEN_MAP, { x: 0.1, y: 30 }, "nw", 0.1);
  assert.deepEqual(screenOf(west), { col: 4, row: 2 });
  assert.ok(west.x > WORLD_TILES - 0.5);
  // Off the south-west edge of row 5, onto row 1.
  const south = walkFor(OPEN_MAP, { x: 30, y: WORLD_TILES - 0.1 }, "sw", 0.1);
  assert.deepEqual(screenOf(south), { col: 2, row: 0 });
  // Off a corner, onto the diagonally opposite corner screen.
  const corner = walkFor(
    OPEN_MAP,
    { x: WORLD_TILES - 0.05, y: WORLD_TILES - 0.05 },
    "s",
    0.1,
  );
  assert.deepEqual(screenOf(corner), { col: 0, row: 0 });
  // Distances wrap too: the two sides of the seam are next to each other.
  assert.ok(
    wrappedDistance({ x: 0.2, y: 10 }, { x: WORLD_TILES - 0.2, y: 10 }) < 0.5,
  );
  // Walking all the way around the world comes back to the start.
  const lap = walkFor(OPEN_MAP, { x: 5, y: 5 }, "se", WORLD_TILES / WALK_SPEED);
  assert.ok(wrappedDistance(lap, { x: 5, y: 5 }) < 0.1);
});

test("the map is the same every time, and every screen can be crossed", () => {
  const random = seededRandom(1);
  assert.notEqual(random(), random());
  assert.equal(seededRandom(9)(), seededRandom(9)());
  for (const screen of ALL_SCREENS) {
    const props = buildScreen(screen);
    assert.deepEqual(
      buildScreen(screen),
      props,
      `screen ${screenName(screen)} changed`,
    );
    for (const prop of props) assert.deepEqual(screenOf(prop), screen);
    // Blocking scenery stays off the outer ring, so the edges are always walkable.
    const left = screen.col * SCREEN_TILES;
    const top = screen.row * SCREEN_TILES;
    for (const prop of props.filter(
      (candidate) => candidate.footprint?.kind === "circle",
    )) {
      assert.ok(
        prop.x - left >= 1 && prop.x - left <= SCREEN_TILES - 1,
        `${prop.kind} too near an edge`,
      );
      assert.ok(
        prop.y - top >= 1 && prop.y - top <= SCREEN_TILES - 1,
        `${prop.kind} too near an edge`,
      );
    }
  }
  // Only the home screen has the house.
  for (const screen of ALL_SCREENS) {
    const hasHouse = buildScreen(screen).some((prop) => prop.kind === "house");
    assert.equal(
      hasHouse,
      screen.col === HOME_SCREEN.col && screen.row === HOME_SCREEN.row,
    );
  }
});

test("every open spot on every screen can be reached by walking from its edges", () => {
  const map = createWorldMap();
  for (const screen of ALL_SCREENS) {
    const left = screen.col * SCREEN_TILES;
    const top = screen.row * SCREEN_TILES;
    // A grid of half-tile steps over the screen; flood-fill from the edge spots.
    const size = SCREEN_TILES * 2;
    const open = (i: number, j: number) =>
      !isBlocked(map, { x: left + (i + 0.5) / 2, y: top + (j + 0.5) / 2 });
    const reached = new Set<string>();
    const queue: [number, number][] = [];
    for (let k = 0; k < size; k++) {
      for (const [i, j] of [
        [k, 0],
        [k, size - 1],
        [0, k],
        [size - 1, k],
      ] as const) {
        if (open(i, j) && !reached.has(`${i},${j}`)) {
          reached.add(`${i},${j}`);
          queue.push([i, j]);
        }
      }
    }
    while (queue.length) {
      const [i, j] = queue.shift()!;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const [ni, nj] = [i + di, j + dj];
        if (
          ni < 0 ||
          nj < 0 ||
          ni >= size ||
          nj >= size ||
          reached.has(`${ni},${nj}`) ||
          !open(ni, nj)
        )
          continue;
        reached.add(`${ni},${nj}`);
        queue.push([ni, nj]);
      }
    }
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (open(i, j))
          assert.ok(
            reached.has(`${i},${j}`),
            `a sealed-off spot on ${screenName(screen)}`,
          );
      }
    }
  }
});

test("scenery and the house block the player, who slides along them instead of sticking", () => {
  const map = createWorldMap();
  // Walking from the doorstep straight at the front wall stops at the wall.
  const stopped = walkFor(map, START, "ne", 3);
  assert.equal(stopped.x, START.x);
  assert.ok(stopped.y - HOUSE.y >= 1.5 + PLAYER_RADIUS - 1e-9);
  assert.ok(stopped.y - HOUSE.y < 1.5 + PLAYER_RADIUS + 0.1);
  assert.equal(isBlocked(map, { x: HOUSE.x, y: HOUSE.y }), true);
  // Walking diagonally into the wall slides along it rather than stopping.
  const slid = walkFor(map, { x: HOUSE.x - 1, y: START.y }, "n", 1);
  assert.ok(
    slid.x < HOUSE.x - 1 - 0.5,
    "the player should keep moving along the wall",
  );
  // Flowers don't block.
  const flowers = ALL_SCREENS.flatMap(buildScreen).find(
    (prop) => prop.kind === "flowers",
  );
  assert.ok(flowers);
  assert.equal(isBlocked(map, flowers), false);
});

test("Legendary professors appear in open places, away from the player and never at home", () => {
  const map = createWorldMap();
  const random = seededRandom(42);
  for (let attempt = 0; attempt < 300; attempt++) {
    const point = pickSpawnPoint(map, START, random);
    assert.ok(point);
    assert.notDeepEqual(screenOf(point), HOME_SCREEN);
    assert.ok(wrappedDistance(point, START) >= SPAWNING.minDistance);
    assert.equal(isBlocked(map, point, 0.6), false);
  }
  // With nowhere open, it gives up instead of looping forever.
  const blocked: WorldMap = {
    propsOn: () => [
      {
        kind: "rock",
        x: 30,
        y: 30,
        footprint: { kind: "box", halfWidth: 99, halfDepth: 99 },
      },
    ],
  };
  assert.equal(pickSpawnPoint(blocked, START, seededRandom(1)), null);
});

test("the player meets a Legendary professor by walking up to them, even across the map's seam", () => {
  const spawn = {
    id: 1,
    professorId: "chao-liu",
    x: 0.3,
    y: 20,
    leavesAt: 100,
  };
  assert.equal(findEncounter({ x: 5, y: 20 }, [spawn]), undefined);
  assert.equal(
    findEncounter({ x: 0.3 + ENCOUNTER_RADIUS * 0.9, y: 20 }, [spawn]),
    spawn,
  );
  assert.equal(findEncounter({ x: WORLD_TILES - 0.3, y: 20 }, [spawn]), spawn);
});
