/** Rules for the rooms, the doors into them, and the capsules in the gashapon machine. */
import assert from "node:assert/strict";
import test from "node:test";

import { createCapsules, shakeCapsules, stepCapsules } from "../capsules.ts";
import type { Globe } from "../capsules.ts";
import {
  HOME_ROOM,
  ROOMS,
  ROOM_DOOR,
  ROOM_ENTRY,
  SCHOOL_ROOM,
  WALLS,
  isRoomBlocked,
  pickRoomSpawnPoint,
  roomUseAt,
  walkRoom,
} from "../rooms.ts";
import {
  DOORS,
  HOME_SCREEN,
  HOUSE,
  SCHOOL,
  SCHOOL_SCREEN,
  SCREEN_TILES,
  START,
  SPAWNING,
  createWorldMap,
  doorAt,
  doorstep,
  isBlocked,
  isHome,
  pickSpawnPoint,
  screenOf,
  seededRandom,
  wrappedDistance,
} from "../world.ts";
import type { Point } from "../world.ts";

test("the school stands on the screen beside home, and both doors can be walked up to", () => {
  assert.deepEqual(screenOf(SCHOOL), SCHOOL_SCREEN);
  assert.deepEqual(screenOf(HOUSE), HOME_SCREEN);
  const map = createWorldMap();
  assert.ok(isBlocked(map, SCHOOL));
  for (const building of ["home", "school"] as const) {
    const step = doorstep(building);
    assert.equal(isBlocked(map, step), false);
    assert.equal(doorAt(step), building);
    // Behind the front wall, or far from the door, there is nothing to enter.
    assert.equal(
      doorAt({ x: DOORS[building].x, y: DOORS[building].y - 0.5 }),
      null,
    );
    assert.equal(
      doorAt({ x: DOORS[building].x + 3, y: DOORS[building].y + 0.5 }),
      null,
    );
  }
  // The player starts on their own doorstep, within reach of the door.
  assert.equal(doorAt(START), "home");
});

test("rooms are walled in, with furniture that blocks and a door in the bottom wall", () => {
  for (const room of Object.values(ROOMS)) {
    assert.equal(isRoomBlocked(room, ROOM_ENTRY), false);
    assert.equal(roomUseAt(room, ROOM_ENTRY), "exit");
    assert.ok(isRoomBlocked(room, { x: SCREEN_TILES / 2, y: WALLS.top - 0.1 }));
    assert.ok(isRoomBlocked(room, { x: 0.1, y: 6 }));
    assert.ok(isRoomBlocked(room, { x: SCREEN_TILES - 0.1, y: 6 }));
    assert.ok(isRoomBlocked(room, { x: 3, y: SCREEN_TILES }));
    for (const item of room.items) {
      if (item.block)
        assert.ok(
          isRoomBlocked(room, { x: item.x, y: item.y - 0.1 }),
          item.art,
        );
    }
  }
  // Walking up into the bed stops at it; walking along the top wall slides.
  const bed = HOME_ROOM.items.find((item) => item.art === "bed")!;
  let at: Point = { x: bed.x, y: bed.y + 2 };
  for (let step = 0; step < 200; step++)
    at = walkRoom(HOME_ROOM, at, "n", 0.02);
  assert.ok(at.y > bed.y && at.y < bed.y + 0.4);
  assert.equal(at.x, bed.x);
});

test("every open spot in a room can be reached from the door", () => {
  for (const room of Object.values(ROOMS)) {
    const key = (x: number, y: number) => `${x},${y}`;
    const open = (x: number, y: number) =>
      !isRoomBlocked(room, { x: x / 4, y: y / 4 });
    const start = [Math.round(ROOM_ENTRY.x * 4), Math.round(ROOM_ENTRY.y * 4)];
    const seen = new Set([key(start[0], start[1])]);
    const queue = [start];
    while (queue.length) {
      const [x, y] = queue.pop()!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const next = [x + dx, y + dy];
        if (seen.has(key(next[0], next[1])) || !open(next[0], next[1]))
          continue;
        seen.add(key(next[0], next[1]));
        queue.push(next);
      }
    }
    for (let x = 0; x <= SCREEN_TILES * 4; x++)
      for (let y = 0; y <= SCREEN_TILES * 4; y++)
        if (open(x, y))
          assert.ok(seen.has(key(x, y)), `${room.id} ${x / 4},${y / 4}`);
  }
});

test("the gashapon machine is in the school, and wild professors only appear in open spots there", () => {
  assert.equal(HOME_ROOM.machine, null);
  assert.ok(SCHOOL_ROOM.machine);
  assert.equal(isRoomBlocked(SCHOOL_ROOM, SCHOOL_ROOM.machine), false);
  assert.equal(roomUseAt(SCHOOL_ROOM, SCHOOL_ROOM.machine), "machine");
  assert.equal(roomUseAt(SCHOOL_ROOM, { x: 6, y: 6.5 }), null);

  // The teacher stands in the school, blocks the way, and can be talked to from beside them.
  assert.equal(HOME_ROOM.npc, null);
  const teacher = SCHOOL_ROOM.npc;
  assert.ok(teacher);
  assert.ok(isRoomBlocked(SCHOOL_ROOM, teacher));
  const beside = { x: teacher.x, y: teacher.y + 0.8 };
  assert.equal(isRoomBlocked(SCHOOL_ROOM, beside), false);
  assert.equal(roomUseAt(SCHOOL_ROOM, beside), "teacher");

  const random = seededRandom(7);
  const player = { x: 6, y: 6 };
  for (let spawn = 0; spawn < 50; spawn++) {
    const point = pickRoomSpawnPoint(SCHOOL_ROOM, player, random);
    assert.ok(point);
    assert.equal(isRoomBlocked(SCHOOL_ROOM, point, 0.6), false);
    assert.ok(Math.hypot(point.x - player.x, point.y - player.y) >= 4);
    assert.ok(Math.hypot(point.x - ROOM_DOOR.x, point.y - ROOM_DOOR.y) >= 2.5);
  }
});

test("capsules stay inside the globe, do not overlap, and settle at the bottom until shaken", () => {
  const globe: Globe = { x: 0, y: 0, radius: 90, capsuleRadius: 16 };
  const random = seededRandom(3);
  const capsules = createCapsules(globe, 8, 6, random);
  assert.equal(capsules.length, 8);
  const inside = () =>
    capsules.every(
      (capsule) =>
        Math.hypot(capsule.x - globe.x, capsule.y - globe.y) <=
        globe.radius - globe.capsuleRadius + 0.001,
    );
  for (let frame = 0; frame < 600; frame++) {
    stepCapsules(capsules, globe, 1 / 60);
    assert.ok(inside());
  }
  // After ten seconds they have piled up at the bottom, barely overlapping.
  const averageY =
    capsules.reduce((sum, capsule) => sum + capsule.y, 0) / capsules.length;
  assert.ok(averageY > globe.radius / 4);
  for (const a of capsules)
    for (const b of capsules)
      if (a !== b)
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > globe.capsuleRadius * 1.5);
  const resting = Math.max(
    ...capsules.map((capsule) => Math.hypot(capsule.vx, capsule.vy)),
  );

  shakeCapsules(capsules, 500, random);
  const tossed = Math.max(
    ...capsules.map((capsule) => Math.hypot(capsule.vx, capsule.vy)),
  );
  assert.ok(tossed > resting + 100);
  for (let frame = 0; frame < 120; frame++) {
    stepCapsules(capsules, globe, 1 / 60);
    assert.ok(inside());
  }
});

test("wild professors appear near the player wherever they are, but never on the home screen", () => {
  const map = createWorldMap();
  const random = seededRandom(11);
  // From home, from the school, and from the far corner of the map.
  for (const player of [START, doorstep("school"), { x: 3, y: 57 }]) {
    for (let spawn = 0; spawn < 40; spawn++) {
      const point = pickSpawnPoint(map, player, random);
      assert.ok(point);
      const distance = wrappedDistance(point, player);
      assert.ok(
        distance >= SPAWNING.minDistance && distance <= SPAWNING.maxDistance,
      );
      assert.equal(isHome(screenOf(point)), false);
    }
  }
});
