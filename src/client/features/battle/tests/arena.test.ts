/** Rules for the real-time battle arena: running, jumping, punching, dodging, and staggering. */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ARENA,
  NO_INPUT,
  createArena,
  enemySpeed,
  poseOf,
  punchPhase,
  stepArena,
} from "../arena.ts";
import type {
  ArenaEvent,
  ArenaInput,
  ArenaState,
  EnemyCommand,
} from "../arena.ts";

// One frame of the game loop, in seconds.
const FRAME = 1 / 60;
const STAND: EnemyCommand = { move: 0, jump: false, attack: false };

/**
 * Runs the arena for a while with the same input every frame.
 * @param state - Where to start.
 * @param seconds - How long to run.
 * @param input - The player's keys.
 * @param command - The enemy's command, or a function choosing one each frame.
 * @returns The arena at the end, every punch that landed, and the highest the player got.
 */
function run(
  state: ArenaState,
  seconds: number,
  input: ArenaInput = NO_INPUT,
  command: EnemyCommand | ((state: ArenaState) => EnemyCommand) = STAND,
) {
  const events: ArenaEvent[] = [];
  let highest = 0;
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += FRAME) {
    const order = typeof command === "function" ? command(state) : command;
    const result = stepArena(state, input, order, FRAME);
    state = result.state;
    events.push(...result.events);
    highest = Math.max(highest, state.player.y);
  }
  return { state, events, highest };
}

/**
 * Puts the fighters a set distance apart, the player on the left.
 * @param gap - The distance between their centres.
 * @returns The arena.
 */
function apart(gap: number): ArenaState {
  const arena = createArena();
  return {
    player: { ...arena.player, x: 300 },
    enemy: { ...arena.enemy, x: 300 + gap },
  };
}

test("the fight starts with the fighters apart on the ground, facing each other", () => {
  const { player, enemy } = createArena();
  assert.equal(player.x, ARENA.playerStart);
  assert.equal(enemy.x, ARENA.enemyStart);
  assert.equal(player.facing, 1);
  assert.equal(enemy.facing, -1);
  assert.equal(poseOf(player), "idle");
  assert.equal(punchPhase(player), "none");
});

test("the player runs at ARENA.playerSpeed and stops at the arena's walls", () => {
  const right = run(createArena(), 0.5, { ...NO_INPUT, right: true });
  assert.ok(
    Math.abs(right.state.player.x - (ARENA.playerStart + ARENA.playerSpeed * 0.5)) < 1e-6,
  );
  assert.equal(poseOf(right.state.player), "walk");

  const left = run(createArena(), 5, { ...NO_INPUT, left: true });
  assert.equal(left.state.player.x, ARENA.left);
  // Both keys cancel out.
  const both = run(createArena(), 0.5, { ...NO_INPUT, left: true, right: true });
  assert.equal(both.state.player.x, ARENA.playerStart);
});

test("a jump rises about 130 units, lands within a second, and can't be repeated in mid-air", () => {
  const jump = { ...NO_INPUT, jump: true };
  const airborne = run(createArena(), 0.1, jump);
  assert.equal(poseOf(airborne.state.player), "jump");

  const { highest } = run(createArena(), 0.35, jump);
  const peak = ARENA.jumpSpeed ** 2 / (2 * ARENA.gravity);
  assert.ok(Math.abs(highest - peak) < 10, `peaked at ${highest}`);

  // Holding jump the whole way never climbs higher than one jump.
  const held = run(createArena(), 0.6, jump);
  assert.ok(held.highest < peak + 10);

  const landed = run(airborne.state, 0.8);
  assert.equal(landed.state.player.y, 0);
  assert.equal(poseOf(landed.state.player), "idle");
});

test("a punch in reach lands once, at the strike, staggering and knocking back the opponent", () => {
  let state = apart(ARENA.reach - 5);
  const punch = { ...NO_INPUT, punch: true };
  const started = stepArena(state, punch, STAND, FRAME);
  assert.equal(punchPhase(started.state.player), "windup");
  assert.deepEqual(started.events, []);

  const { state: after, events } = run(started.state, ARENA.playerWindup + ARENA.strike);
  assert.deepEqual(events, [{ kind: "hit", by: "player" }]);
  assert.ok(after.enemy.hurt > 0);
  assert.equal(poseOf(after.enemy), "hurt");
  assert.ok(after.enemy.x > state.enemy.x);
  state = after;

  // The rest of the punch can't land again.
  assert.deepEqual(run(state, ARENA.recover).events, []);
});

test("punches miss an opponent out of reach or behind the puncher", () => {
  const punch = { ...NO_INPUT, punch: true };
  assert.deepEqual(run(apart(ARENA.reach + 5), 0.5, punch).events, []);

  const turned = apart(40);
  turned.player.facing = -1;
  const first = stepArena(turned, punch, STAND, FRAME);
  // Mid-punch, the player keeps facing the wrong way.
  assert.equal(first.state.player.facing, -1);
  assert.deepEqual(run(first.state, 0.3).events, []);
});

test("a fighter can punch no faster than their cooldown allows", () => {
  const punch = { ...NO_INPUT, punch: true };
  // The enemy stands in reach the whole time.
  const { events } = run(apart(ARENA.reach - 20), 10, punch, () => STAND);
  const most = Math.ceil(10 / ARENA.playerCooldown);
  assert.ok(events.length > 0 && events.length <= most, `${events.length} hits`);

  const enemyHits = run(apart(ARENA.reach - 20), 10, NO_INPUT, {
    move: 0,
    jump: false,
    attack: true,
  }).events.filter((event) => event.by === "enemy");
  assert.ok(enemyHits.length <= Math.ceil(10 / ARENA.enemyCooldown));
  // Together they stay under the server's 240 battle actions a minute.
  assert.ok(60 / ARENA.playerCooldown + 60 / ARENA.enemyCooldown < 240);
});

test("jumping as a punch winds up dodges it", () => {
  const punch = { ...NO_INPUT, punch: true };
  const dodge: EnemyCommand = { move: 0, jump: true, attack: false };
  const { events } = run(apart(ARENA.reach - 5), 0.5, punch, (state) =>
    punchPhase(state.player) === "none" ? STAND : dodge,
  );
  assert.deepEqual(events, []);

  // A punch thrown in mid-air can still catch a jumping opponent.
  const both = { ...NO_INPUT, punch: true, jump: true };
  const caught = run(apart(ARENA.reach - 5), 0.3, both, {
    move: 0,
    jump: true,
    attack: false,
  });
  assert.deepEqual(caught.events, [{ kind: "hit", by: "player" }]);
});

test("a staggered fighter can't run or punch, and being hit interrupts their own punch", () => {
  const state = apart(ARENA.reach - 5);
  state.enemy.hurt = ARENA.hurtTime;
  const { state: after } = run(state, ARENA.hurtTime / 2, NO_INPUT, {
    move: 1,
    jump: true,
    attack: true,
  });
  assert.equal(after.enemy.x, state.enemy.x);
  assert.equal(after.enemy.y, 0);
  assert.equal(after.enemy.punchTime, null);

  // Both wind up together; the player's punch lands first and cancels the enemy's.
  const trade = run(apart(ARENA.reach - 5), 0.5, { ...NO_INPUT, punch: true }, (now) =>
    now.enemy.cooldown === 0 && now.enemy.hurt === 0 && now.player.punchTime === null
      ? { move: 0, jump: false, attack: true }
      : STAND,
  );
  assert.deepEqual(trade.events, [{ kind: "hit", by: "player" }]);
});

test("fighters on the ground can't walk through each other, but can jump over", () => {
  const towards = { ...NO_INPUT, right: true };
  const blocked = run(apart(100), 2, towards);
  assert.ok(blocked.state.enemy.x - blocked.state.player.x >= ARENA.bodyWidth - 1e-6);

  const leap = run(apart(60), 0.6, { ...towards, jump: true });
  assert.ok(leap.state.player.x > leap.state.enemy.x, "the player jumped over");
  // Once past, they turn round to face the enemy again.
  assert.equal(leap.state.player.facing, -1);
});

test("the enemy runs at its own speed, always a little slower than the player", () => {
  const { state } = run(createArena(), 0.5, NO_INPUT, {
    move: -1,
    jump: false,
    attack: false,
  });
  assert.ok(Math.abs(state.enemy.x - (ARENA.enemyStart - enemySpeed() * 0.5)) < 1e-6);
  assert.equal(enemySpeed({ speed: 75 }), 225);
  assert.ok(enemySpeed({ speed: 500 }) < ARENA.playerSpeed);
});

test("the enemy AI can choose which way it faces", () => {
  const { state } = stepArena(createArena(), NO_INPUT, { ...STAND, facing: 1 }, FRAME);
  assert.equal(state.enemy.facing, 1);
});

test("a level bonus makes the player run faster", () => {
  const boosted = stepArena(
    createArena(),
    { ...NO_INPUT, right: true },
    STAND,
    0.1,
    enemySpeed(),
    ARENA.playerSpeed * 2,
  );
  assert.ok(
    Math.abs(boosted.state.player.x - (ARENA.playerStart + ARENA.playerSpeed * 2 * 0.1)) < 1e-6,
  );
});
