/** The enemy professor AI, playing in the real arena against a player standing still or punching. */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ARENA,
  NO_INPUT,
  createArena,
  enemySpeed,
  punchPhase,
  stepArena,
} from "../arena.ts";
import type { ArenaEvent, ArenaInput, ArenaState } from "../arena.ts";
import { createEnemyBrain } from "../enemyBrain.ts";
import type { ArenaHealth } from "../enemyBrain.ts";

const FRAME = 1 / 60;
const FULL: ArenaHealth = { enemy: 50, enemyMax: 50, player: 100, playerMax: 100 };
const FRANK_WOOD = { health: 50, attack: 46, defense: 80, speed: 75 };

/**
 * Plays the AI against the player for a while.
 * @param seconds - How long to play.
 * @param input - The player's keys each frame.
 * @param health - Both fighters' health.
 * @param state - Where to start.
 * @param random - Random numbers for the AI.
 * @returns The arena at the end, the punches that landed, how high the enemy got, and whether
 * the enemy was ever seen winding up a punch.
 */
function play(
  seconds: number,
  input: (state: ArenaState) => ArenaInput = () => NO_INPUT,
  health = FULL,
  state: ArenaState = createArena(),
  random: () => number = () => 0,
) {
  const speed = enemySpeed(FRANK_WOOD);
  const brain = createEnemyBrain(FRANK_WOOD, speed, random);
  const events: ArenaEvent[] = [];
  let highest = 0;
  let telegraphed = false;
  for (let elapsed = 0; elapsed < seconds; elapsed += FRAME) {
    const command = brain.decide(state, health, FRAME);
    const result = stepArena(state, input(state), command, FRAME, speed);
    state = result.state;
    events.push(...result.events);
    highest = Math.max(highest, state.enemy.y);
    telegraphed ||= punchPhase(state.enemy) === "windup";
  }
  return { state, events, highest, telegraphed };
}

test("the professor runs at a player who stands still, winds up where they can see it, and lands punches", () => {
  const { events, telegraphed } = play(6);
  assert.ok(telegraphed);
  const hits = events.filter((event) => event.by === "enemy").length;
  // A player who never moves takes about one punch a second, and never faster than the cooldown.
  assert.ok(hits >= 4, `only ${hits} hits in 6 seconds`);
  assert.ok(hits <= Math.ceil(6 / ARENA.enemyCooldown));
});

test("the professor jumps to dodge a punch thrown at close range", () => {
  const start = createArena();
  start.player.x = 400;
  start.enemy.x = 400 + ARENA.reach - 5;
  const punch = (state: ArenaState) => ({
    ...NO_INPUT,
    punch: punchPhase(state.player) === "none",
  });
  const { highest } = play(0.5, punch, FULL, start);
  assert.ok(highest > ARENA.dodgeHeight, `only rose ${highest}`);
});

test("a professor low on health backs away from a nearby player", () => {
  const start = createArena();
  start.player.x = 400;
  start.enemy.x = 480;
  const { state } = play(0.4, () => NO_INPUT, { ...FULL, enemy: 5 }, start);
  assert.ok(state.enemy.x > 480, "it should retreat to the right");
});

test("a knocked-out professor stops fighting", () => {
  const { events, state } = play(3, () => NO_INPUT, { ...FULL, enemy: 0 });
  assert.deepEqual(events, []);
  assert.equal(state.enemy.x, ARENA.enemyStart);
});
