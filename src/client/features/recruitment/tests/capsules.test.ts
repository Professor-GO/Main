/** The capsules tumbling in the gashapon globe. */
import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPSULE_FOR,
  CAPSULE_RADIUS,
  createCapsules,
  shake,
  stepCapsules,
} from "../capsules.ts";
import type { Capsule } from "../capsules.ts";

/**
 * Returns a predictable stand-in for Math.random.
 * @param seed - Where the sequence starts.
 * @returns Numbers from 0 to 1.
 */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

/** Checks that every capsule is inside the glass and none overlap by more than `slack`. */
function assertInside(capsules: Capsule[], slack = 0.02) {
  for (const capsule of capsules) {
    assert.ok(Math.hypot(capsule.x, capsule.y) <= 1 - CAPSULE_RADIUS + slack);
  }
  for (let i = 0; i < capsules.length; i++) {
    for (let j = i + 1; j < capsules.length; j++) {
      const gap = Math.hypot(capsules[i].x - capsules[j].x, capsules[i].y - capsules[j].y);
      assert.ok(gap >= CAPSULE_RADIUS * 2 - slack, `capsules ${i} and ${j} overlap`);
    }
  }
}

/** The average height of the capsules; lower numbers are higher up the globe. */
const averageY = (capsules: Capsule[]) =>
  capsules.reduce((sum, capsule) => sum + capsule.y, 0) / capsules.length;

test("the globe starts with the capsules resting in its bottom half, clear of each other", () => {
  const capsules = createCapsules(16, seeded(1));
  assert.equal(capsules.length, 16);
  assertInside(capsules, 1e-9);
  assert.ok(averageY(capsules) > 0.2);
  // Every capsule colour is used.
  assert.equal(new Set(capsules.map((capsule) => capsule.color)).size, 6);
});

test("shaking throws the capsules up, and they fall back without leaving the glass", () => {
  const capsules = createCapsules(16, seeded(2));
  stepCapsules(capsules, 2);
  const resting = averageY(capsules);
  shake(capsules, seeded(3));
  stepCapsules(capsules, 0.15);
  assert.ok(averageY(capsules) < resting - 0.1, "the capsules should fly up");
  for (let second = 0; second < 2; second += 0.25) {
    shake(capsules, seeded(4 + second * 8));
    stepCapsules(capsules, 0.25);
    assertInside(capsules, 0.06);
  }
  stepCapsules(capsules, 4);
  assertInside(capsules);
  assert.ok(Math.abs(averageY(capsules) - resting) < 0.2, "the capsules should settle again");
});

test("long frames are split into small steps, so capsules never tunnel through the glass", () => {
  const capsules = createCapsules(4, seeded(5));
  for (const capsule of capsules) capsule.vy = -40;
  stepCapsules(capsules, 1);
  assertInside(capsules);
});

test("each rarity has its own capsule colour", () => {
  assert.deepEqual(CAPSULE_FOR, { Legendary: "yellow", Epic: "pink", Rare: "blue", Common: "green" });
});
