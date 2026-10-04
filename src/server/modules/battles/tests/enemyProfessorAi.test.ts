import test from "node:test";
import assert from "node:assert/strict";
import {
  createEnemyAi,
  stepEnemyAi,
} from "../../../../shared/battle/enemyProfessorAi.ts";
import type {
  AiFighter,
  EnemyAiObservation,
} from "../../../../shared/battle/enemyProfessorAi.ts";

/** A grounded fighter ready to act, in SVG arena units. */
function fighter(x: number): AiFighter {
  return {
    x,
    y: 0,
    vx: 0,
    vy: 0,
    grounded: true,
    facing: -1,
    punch: "none",
    hurt: false,
    hp: 100,
    maxHp: 100,
  };
}

/** A normal frame with the enemy on the right and player on the left. */
function observation(): EnemyAiObservation {
  return {
    dtMs: 20,
    self: fighter(550),
    player: fighter(250),
    arena: { minX: 70, maxX: 730 },
    reach: 110,
  };
}

test("enemy approaches on either side and reverses when the player crosses it", () => {
  const obs = observation();
  const first = stepEnemyAi(createEnemyAi(), obs);
  assert.equal(first.command.move, -1);
  assert.equal(first.command.attack, false);
  obs.player.x = 720;
  assert.equal(stepEnemyAi(first.state, obs).command.move, 1);
});

test("enemy attacks only at reachable height and distance", () => {
  const obs = observation();
  obs.player.x = 470;
  const result = stepEnemyAi(createEnemyAi(), obs);
  assert.deepEqual(result.command, { move: 0, jump: false, attack: true });
  obs.player.y = 60;
  assert.equal(stepEnemyAi(createEnemyAi(), obs).command.attack, false);
  obs.self.grounded = false;
  obs.player.y = 0;
  assert.equal(stepEnemyAi(createEnemyAi(), obs).command.attack, false);
});

test("attacks remain at least a second apart even for the fastest professor", () => {
  for (const speed of [0, 80, 999]) {
    const obs = observation();
    obs.player.x = 470;
    let state = createEnemyAi({ health: 100, attack: 50, defense: 20, speed });
    const times: number[] = [];
    for (let time = 20; time <= 5000; time += obs.dtMs) {
      const result = stepEnemyAi(state, obs);
      state = result.state;
      if (result.command.attack) times.push(time);
    }
    assert.ok(times.length >= 3);
    for (let index = 1; index < times.length; index++)
      assert.ok(times[index] - times[index - 1] >= 1000);
  }
});

test("hurt and all punch phases suppress new control commands", () => {
  const obs = observation();
  obs.player.x = 470;
  for (const punch of ["windup", "strike", "recover"] as const) {
    obs.self.punch = punch;
    assert.deepEqual(stepEnemyAi(createEnemyAi(), obs).command, {
      move: 0,
      jump: false,
      attack: false,
    });
  }
  obs.self.punch = "none";
  obs.self.hurt = true;
  assert.deepEqual(stepEnemyAi(createEnemyAi(), obs).command, {
    move: 0,
    jump: false,
    attack: false,
  });
});

test("a nearby visible punch triggers one jump dodge, then waits for landing", () => {
  const obs = observation();
  obs.player.x = 470;
  obs.player.punch = "windup";
  let result = stepEnemyAi(createEnemyAi(), obs, () => 0);
  assert.equal(result.command.jump, true);
  assert.equal(result.command.move, 1);
  assert.equal(result.state.mode, "dodge");
  obs.self.grounded = false;
  obs.self.y = 80;
  for (let index = 0; index < 50; index++) {
    result = stepEnemyAi(result.state, obs, () => 0);
    assert.equal(result.command.jump, false);
    assert.equal(result.command.attack, false);
  }
  obs.self.grounded = true;
  obs.self.y = 0;
  obs.player.punch = "none";
  result = stepEnemyAi(result.state, obs, () => 0);
  assert.equal(result.state.mode, "chase");
  assert.equal(result.command.attack, true);
});

test("failed dodge rolls cannot be retried every frame", () => {
  const obs = observation();
  obs.player.x = 470;
  obs.player.punch = "windup";
  let rolls = 0;
  const fail = () => {
    rolls++;
    return 0.99;
  };
  let result = stepEnemyAi(createEnemyAi(), obs, fail);
  assert.equal(result.command.jump, false);
  for (let index = 0; index < 20; index++) {
    result = stepEnemyAi(result.state, obs, fail);
    assert.equal(result.command.jump, false);
  }
  assert.equal(rolls, 1);
});

test("far away or airborne player attacks do not provoke dodges", () => {
  const obs = observation();
  obs.player.punch = "strike";
  assert.equal(stepEnemyAi(createEnemyAi(), obs, () => 0).command.jump, false);
  obs.player.x = 470;
  obs.player.y = 70;
  assert.equal(stepEnemyAi(createEnemyAi(), obs, () => 0).command.jump, false);
});

test("low health causes a short retreat followed by re-engagement", () => {
  const obs = observation();
  obs.player.x = 470;
  obs.self.hp = 30;
  let result = stepEnemyAi(createEnemyAi(), obs);
  assert.equal(result.command.move, 1);
  assert.equal(result.state.mode, "retreat");
  for (let index = 0; index < 30; index++)
    result = stepEnemyAi(result.state, obs);
  assert.equal(result.state.mode, "chase");
  assert.equal(result.command.attack, true);
  assert.ok(result.state.retreatCooldownMs > 0);
});

test("walls prevent retreat or dodge movement outside either arena edge", () => {
  for (const edge of [70, 730]) {
    const obs = observation();
    obs.self.x = edge;
    obs.self.hp = 20;
    obs.player.x = edge === 70 ? 140 : 660;
    let result = stepEnemyAi(createEnemyAi(), obs);
    assert.equal(result.state.mode, "chase");
    assert.equal(result.command.move, 0);
    assert.equal(result.command.attack, true);
    result = stepEnemyAi(
      {
        ...createEnemyAi(),
        mode: "retreat",
        remainingMs: 400,
        retreatCooldownMs: 2000,
      },
      obs,
    );
    assert.equal(result.state.mode, "chase");
    obs.player.punch = "windup";
    result = stepEnemyAi(createEnemyAi(), obs, () => 0);
    assert.equal(result.command.move, 0);
    assert.equal(result.command.jump, true);
  }
});

test("zero elapsed time and defeated fighters are inert", () => {
  const obs = observation();
  const state = { ...createEnemyAi(), attackCooldownMs: 500 };
  for (const change of [
    { dtMs: 0 },
    { self: { ...obs.self, hp: 0 } },
    { player: { ...obs.player, hp: 0 } },
  ]) {
    const result = stepEnemyAi(state, { ...obs, ...change });
    assert.deepEqual(result.state, state);
    assert.deepEqual(result.command, { move: 0, jump: false, attack: false });
  }
});

test("long frame gaps cannot skip the whole attack cooldown", () => {
  const obs = observation();
  obs.player.x = 470;
  obs.dtMs = 10_000;
  const result = stepEnemyAi(
    { ...createEnemyAi(), attackCooldownMs: 1100 },
    obs,
  );
  assert.equal(result.command.attack, false);
  assert.equal(result.state.attackCooldownMs, 1000);
});

test("decisions are reproducible and leave observations and state unchanged", () => {
  const obs = observation();
  obs.player.x = 470;
  obs.player.punch = "windup";
  const state = createEnemyAi();
  const snapshot = structuredClone({ state, obs });
  assert.deepEqual(
    stepEnemyAi(state, obs, () => 0.2),
    stepEnemyAi(state, obs, () => 0.2),
  );
  assert.deepEqual({ state, obs }, snapshot);
  assert.throws(() => stepEnemyAi(state, { ...obs, dtMs: NaN }), /Invalid/);
  assert.throws(() => stepEnemyAi(state, { ...obs, dtMs: -1 }), /Invalid/);
});
