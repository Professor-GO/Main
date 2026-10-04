/** Rules for the campus map: screens, wrapping, walking, collisions, and Legendary spawns. */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DIRECTION_VECTORS,
  ENCOUNTER_RADIUS,
  HOME_SCREEN,
  HOUSE,
  PLAYER_RADIUS,
  ROAMING,
  SCREEN_TILES,
  SPAWN_RADIUS,
  SPAWNING,
  START,
  TREE_KINDS,
  WALK_SPEED,
  WORLD_SCREENS,
  WORLD_TILES,
  buildScreen,
  createWorldMap,
  directionFor,
  findEncounter,
  isBlocked,
  isChaser,
  isHome,
  isUnderCanopy,
  moveSpawn,
  pickSpawnLevel,
  pickSpawnPoint,
  screenName,
  screenOf,
  seededRandom,
  walk,
  wrap,
  wrappedDistance,
} from "../world.ts";
import type { Direction, Point, Screen, Spawn, WorldMap } from "../world.ts";

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
  // The player starts on their doorstep, not inside a wall or the mailbox, and can step
  // straight off it to the left, right, or down.
  const map = createWorldMap();
  assert.equal(isBlocked(map, START), false);
  for (const direction of ["e", "w", "s"] as const) {
    const moved = walkFor(map, START, direction, 0.5);
    assert.ok(
      wrappedDistance(START, moved) > 1.5,
      `blocked walking ${direction} from the doorstep`,
    );
  }
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
  // Seen from above, up is straight up the screen (-y) and right is straight right (+x).
  assert.deepEqual(DIRECTION_VECTORS.n, { x: 0, y: -1 });
  assert.deepEqual(DIRECTION_VECTORS.e, { x: 1, y: 0 });
  assert.deepEqual(DIRECTION_VECTORS.s, { x: 0, y: 1 });
  assert.deepEqual(DIRECTION_VECTORS.w, { x: -1, y: 0 });
  assert.ok(DIRECTION_VECTORS.ne.x > 0 && DIRECTION_VECTORS.ne.y < 0);
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
  // Start near the right edge of the home screen (x close to the end of column C).
  const nearEdge = { x: 3 * SCREEN_TILES - 0.1, y: 30 };
  const across = walkFor(OPEN_MAP, nearEdge, "e", 0.1);
  assert.deepEqual(screenOf(nearEdge), HOME_SCREEN);
  assert.deepEqual(screenOf(across), { col: 3, row: 2 });
  // It lands just inside the next screen's opposite (left) edge, at the same height.
  assert.ok(across.x - 3 * SCREEN_TILES < 0.5);
  assert.equal(across.y, 30);
  // And straight back again.
  assert.deepEqual(screenOf(walkFor(OPEN_MAP, across, "w", 0.2)), HOME_SCREEN);
  // Off the top edge, onto the screen above.
  assert.deepEqual(
    screenOf(walkFor(OPEN_MAP, { x: 30, y: 2 * SCREEN_TILES + 0.1 }, "n", 0.1)),
    { col: 2, row: 1 },
  );
});

test("walking off the edge of the whole map wraps around to the opposite side", () => {
  assert.equal(wrap(-0.5), WORLD_TILES - 0.5);
  assert.equal(wrap(WORLD_TILES + 1), 1);
  // Off the left edge of column A, onto column E.
  const west = walkFor(OPEN_MAP, { x: 0.1, y: 30 }, "w", 0.1);
  assert.deepEqual(screenOf(west), { col: 4, row: 2 });
  assert.ok(west.x > WORLD_TILES - 0.5);
  // Off the bottom edge of row 5, onto row 1.
  const south = walkFor(OPEN_MAP, { x: 30, y: WORLD_TILES - 0.1 }, "s", 0.1);
  assert.deepEqual(screenOf(south), { col: 2, row: 0 });
  // Off a corner, onto the diagonally opposite corner screen.
  const corner = walkFor(
    OPEN_MAP,
    { x: WORLD_TILES - 0.05, y: WORLD_TILES - 0.05 },
    "se",
    0.1,
  );
  assert.deepEqual(screenOf(corner), { col: 0, row: 0 });
  // Distances wrap too: the two sides of the seam are next to each other.
  assert.ok(
    wrappedDistance({ x: 0.2, y: 10 }, { x: WORLD_TILES - 0.2, y: 10 }) < 0.5,
  );
  // Walking all the way around the world comes back to the start.
  const lap = walkFor(OPEN_MAP, { x: 5, y: 5 }, "e", WORLD_TILES / WALK_SPEED);
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
  // Walking from the doorstep straight up at the front wall stops at the wall.
  const stopped = walkFor(map, START, "n", 3);
  assert.equal(stopped.x, START.x);
  assert.ok(stopped.y - HOUSE.y >= 1.5 + PLAYER_RADIUS - 1e-9);
  assert.ok(stopped.y - HOUSE.y < 1.5 + PLAYER_RADIUS + 0.1);
  assert.equal(isBlocked(map, { x: HOUSE.x, y: HOUSE.y }), true);
  // Walking diagonally into the wall slides along it rather than stopping.
  const slid = walkFor(map, { x: HOUSE.x - 1, y: START.y }, "nw", 1);
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

test("only a tree's trunk blocks: the player walks under its leaves, which hide them", () => {
  const map = createWorldMap();
  const trees = ALL_SCREENS.flatMap(buildScreen).filter((prop) =>
    TREE_KINDS.includes(prop.kind),
  );
  assert.ok(trees.length > 20);
  for (const tree of trees) {
    // The trunk itself blocks.
    assert.equal(isBlocked(map, tree), true, `${tree.kind} trunk should block`);
    // Just behind the trunk (up the screen), under the leaves, is open ground...
    const behind = { x: tree.x, y: tree.y - 0.8 };
    assert.equal(
      isBlocked(map, behind),
      false,
      `${tree.kind} leaves should not block`,
    );
    // ...where the tree hides the player, because the tree is drawn after them. In front of
    // the trunk (down the screen), this tree does not hide them. (Another tree lower down
    // might, so this checks the tree on its own.)
    const alone: WorldMap = { propsOn: () => [tree] };
    assert.equal(isUnderCanopy(alone, behind), true);
    assert.equal(isUnderCanopy(alone, { x: tree.x, y: tree.y + 0.6 }), false);
  }
  // The player can walk from below a tree, around its trunk, to stand under its leaves.
  const tree = trees.find(
    (candidate) =>
      !isBlocked(map, { x: candidate.x + 0.6, y: candidate.y + 0.6 }),
  )!;
  let at = { x: tree.x + 0.6, y: tree.y + 0.6 };
  at = walkFor(map, at, "n", 0.4);
  assert.ok(at.y < tree.y, "walked past the trunk");
  assert.equal(isUnderCanopy({ propsOn: () => [tree] }, at), true);
  // Nothing on the home screen hangs over the doorstep where the player starts.
  assert.equal(isUnderCanopy(map, START), false);
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
    // Never under a tree, where the leaves would hide them.
    assert.equal(isUnderCanopy(map, point), false);
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
    level: 10,
    x: 0.3,
    y: 20,
    leavesAt: 100,
    chaser: false,
    chasing: false,
    heading: { x: 0, y: 0 },
    turnAt: 0,
  };
  assert.equal(findEncounter({ x: 5, y: 20 }, [spawn]), undefined);
  assert.equal(
    findEncounter({ x: 0.3 + ENCOUNTER_RADIUS * 0.9, y: 20 }, [spawn]),
    spawn,
  );
  assert.equal(findEncounter({ x: WORLD_TILES - 0.3, y: 20 }, [spawn]), spawn);
});

// ---------------------------------------------------------------- Roaming

// Today's two Legendary professors: Frank Wood adds up to 251 and Chao Liu to 212.
const FRANK_WOOD_STATS = { health: 50, attack: 46, defense: 80, speed: 75 };
const CHAO_LIU_STATS = { health: 48, attack: 44, defense: 55, speed: 65 };
// One frame of the game loop, in seconds.
const FRAME = 0.02;

/**
 * Makes a professor standing still at a point, ready to choose a way to wander.
 * @param at - Where they stand.
 * @param chaser - Whether they chase the player.
 * @returns The professor.
 */
function roamer(at: Point, chaser: boolean): Spawn {
  return {
    id: 1,
    professorId: "frank-wood",
    level: 10,
    ...at,
    leavesAt: 1000,
    chaser,
    chasing: false,
    heading: { x: 0, y: 0 },
    turnAt: 0,
  };
}

/**
 * Runs a professor for a while, in small steps like the game loop takes.
 * @param map - The map.
 * @param spawn - The professor.
 * @param player - Where the player stands.
 * @param seconds - How long to run.
 * @param random - A random number generator.
 * @param check - Called with the professor before and after every frame.
 * @returns The professor at the end.
 */
function roamFor(
  map: WorldMap,
  spawn: Spawn,
  player: Point,
  seconds: number,
  random: () => number = seededRandom(7),
  check: (before: Spawn, after: Spawn) => void = () => {},
): Spawn {
  let at = spawn;
  for (let time = 0; time < seconds - 1e-9; time += FRAME) {
    const next = moveSpawn(map, at, player, time, FRAME, random);
    check(at, next);
    at = next;
  }
  return at;
}

test("only professors whose stats add up to ROAMING.chaserPower chase the player", () => {
  assert.equal(isChaser(FRANK_WOOD_STATS), true);
  assert.equal(isChaser(CHAO_LIU_STATS), false);
  assert.equal(isChaser(undefined), false);
  assert.equal(
    isChaser({ health: ROAMING.chaserPower - 3, attack: 1, defense: 1, speed: 1 }),
    true,
  );
  assert.equal(
    isChaser({ health: ROAMING.chaserPower - 4, attack: 1, defense: 1, speed: 1 }),
    false,
  );
});

test("wandering professors roam the map at a stroll, through scenery never, and never into home", () => {
  const map = createWorldMap();
  const random = seededRandom(3);
  for (let professor = 0; professor < 5; professor++) {
    const start = pickSpawnPoint(map, START, random);
    assert.ok(start);
    let travelled = 0;
    const end = roamFor(map, roamer(start, false), START, 120, random, (before, after) => {
      const step = wrappedDistance(before, after);
      assert.ok(step <= ROAMING.wanderSpeed * FRAME + 1e-9, `stepped ${step} tiles`);
      assert.equal(isHome(screenOf(after)), false);
      assert.equal(isBlocked(map, after, SPAWN_RADIUS), false);
      assert.equal(after.chasing, false);
      travelled += step;
    });
    // They really do move about, rather than standing where they appeared.
    assert.ok(travelled > 30, `only travelled ${travelled} tiles`);
    assert.ok(wrappedDistance(start, end) > 0);
  }
});

test("wandering professors ignore a player standing right next to them", () => {
  const spawn = roamer({ x: 6, y: 6 }, false);
  const after = roamFor(OPEN_MAP, spawn, { x: 7, y: 6 }, 2);
  assert.equal(after.chasing, false);
});

test("a chaser runs at the player once they come within ROAMING.noticeRadius", () => {
  const player = { x: 10, y: 5 };
  // Just too far away to be noticed: they wander instead.
  const far = roamer({ x: 10 - ROAMING.noticeRadius - 0.5, y: 5 }, true);
  assert.equal(moveSpawn(OPEN_MAP, far, player, 0, FRAME, seededRandom(1)).chasing, false);

  const near = roamer({ x: 10 - ROAMING.noticeRadius + 0.5, y: 5 }, true);
  const before = wrappedDistance(near, player);
  const after = roamFor(OPEN_MAP, near, player, 1);
  assert.equal(after.chasing, true);
  assert.ok(Math.abs(before - wrappedDistance(after, player) - ROAMING.chaseSpeed) < 1e-6);
  // Slower than the player, so running away works.
  assert.ok(ROAMING.chaseSpeed < WALK_SPEED);
});

test("a chaser keeps chasing until the player is ROAMING.giveUpRadius away", () => {
  const player = { x: 30, y: 5 };
  const chasing = { ...roamer({ x: 30 - ROAMING.noticeRadius - 1, y: 5 }, true), chasing: true };
  assert.equal(moveSpawn(OPEN_MAP, chasing, player, 0, FRAME, seededRandom(1)).chasing, true);

  const escaped = { ...chasing, x: 30 - ROAMING.giveUpRadius - 0.5 };
  assert.equal(moveSpawn(OPEN_MAP, escaped, player, 0, FRAME, seededRandom(1)).chasing, false);
});

test("a chaser catches a player who stands still, even across the map's seam", () => {
  const player = { x: 1, y: 5 };
  const chaser = roamer({ x: WORLD_TILES - 4, y: 5 }, true);
  const after = roamFor(OPEN_MAP, chaser, player, 3);
  assert.equal(findEncounter(player, [after]), after);
});

test("a chaser works its way round a rock in the way", () => {
  const rock = {
    kind: "rock" as const,
    x: 23,
    y: 5,
    footprint: { kind: "circle" as const, radius: 0.35 },
  };
  const map: WorldMap = { propsOn: () => [rock] };
  const player = { x: 26, y: 5 };
  for (const id of [1, 2]) {
    const chaser = { ...roamer({ x: 20.5, y: 5 }, true), id };
    const after = roamFor(map, chaser, player, 4, seededRandom(1), (_, next) =>
      assert.equal(isBlocked(map, next, SPAWN_RADIUS), false),
    );
    assert.equal(findEncounter(player, [after]), after, `professor ${id} got stuck`);
  }
});

test("home is safe: a chaser gives up on a player at home and never follows them in", () => {
  const homeTop = HOME_SCREEN.row * SCREEN_TILES;
  const chaser = {
    ...roamer({ x: HOUSE.x, y: homeTop - 2 }, true),
    chasing: true,
  };
  // Just inside the home screen: close by, but out of reach.
  const player = { x: HOUSE.x, y: homeTop + 0.5 };
  const after = roamFor(OPEN_MAP, chaser, player, 5, seededRandom(1), (_, next) =>
    assert.equal(isHome(screenOf(next)), false),
  );
  assert.equal(after.chasing, false);
  assert.equal(findEncounter(player, [after]), undefined);
});

test("Legendary professors appear at level 10 to 100, every level possible", () => {
  assert.equal(pickSpawnLevel(() => 0), SPAWNING.minLevel);
  assert.equal(pickSpawnLevel(() => 0.999999), SPAWNING.maxLevel);
  assert.equal(SPAWNING.minLevel, 10);
  assert.equal(SPAWNING.maxLevel, 100);
  const seen = new Set<number>();
  const random = seededRandom(9);
  for (let roll = 0; roll < 5000; roll++) {
    const level = pickSpawnLevel(random);
    assert.ok(Number.isInteger(level) && level >= 10 && level <= 100, `level ${level}`);
    seen.add(level);
  }
  assert.equal(seen.size, 91);
});
