import test from "node:test";
import assert from "node:assert/strict";
import {
  createCombat,
  enemyStrike,
  resolveQuiz,
  strike,
} from "../../../../../BackEnd/Game Engine/encounterBattle.ts";

test("checkpoints fall inside both health bands and at 10% for every current professor HP", () => {
  for (const health of [48, 50, 57, 62, 67, 89, 200]) {
    for (const random of [() => 0, () => 0.999999]) {
      const state = createCombat({ health, attack: 40, defense: 80 }, random);
      assert.ok(
        state.checkpoints[0] / health >= 2 / 3 &&
          state.checkpoints[0] / health <= 3 / 4,
      );
      assert.ok(
        state.checkpoints[1] / health >= 1 / 3 &&
          state.checkpoints[1] / health <= 3 / 5,
      );
      assert.equal(state.checkpoints[2], Math.floor(health / 10));
    }
  }
});

test("strikes use floor attack/defense and professor punches clamp player health at zero", () => {
  let state = createCombat({ health: 100, attack: 2000, defense: 80 }, () => 0);
  state = strike(state);
  assert.equal(state.health, 93);
  assert.equal(state.playerHealth, 100);
  state = enemyStrike(state);
  assert.equal(state.playerHealth, 0);
  assert.equal(state.status, "lost");
  assert.throws(() => strike(state));
  assert.throws(() => enemyStrike(state));
});

test("wrong answers heal 50–80% of current lost HP rounded down; correct answers do not heal", () => {
  const state = {
    ...createCombat({ health: 100, attack: 0, defense: 80 }, () => 0),
    health: 67,
    status: "question" as const,
    pendingEvent: 0,
    eventsTriggered: 1,
  };
  assert.equal(resolveQuiz(state, true).state.health, 67);
  assert.equal(resolveQuiz(state, false, () => 0).healed, 16);
  assert.equal(resolveQuiz(state, false, () => 0.999999).healed, 26);
  assert.equal(resolveQuiz(state, false, () => 0.999999).state.health, 93);
  assert.equal(state.health, 67);
});

test("one lethal strike is interrupted at all three checkpoints, retaining its damage", () => {
  let state = createCombat({ health: 100, attack: 0, defense: 1 }, () => 0);
  state = strike(state);
  for (const hp of [67, 34, 10]) {
    assert.equal(state.status, "question");
    assert.equal(state.health, hp);
    assert.throws(() => strike(state));
    state = resolveQuiz(state, true).state;
  }
  assert.equal(state.eventsTriggered, 3);
  assert.equal(state.health, 0);
  assert.equal(state.status, "won");
});

test("healing across a checkpoint never repeats an event", () => {
  let state = createCombat({ health: 100, attack: 0, defense: 60 }, () => 0);
  while (state.status === "fighting") state = strike(state);
  state = resolveQuiz(state, false, () => 0.999999).state;
  assert.ok(state.health > state.checkpoints[0]);
  while (state.status === "fighting") state = strike(state);
  assert.equal(state.pendingEvent, 1);
  state = resolveQuiz(state, false, () => 0.999999).state;
  while (state.status === "fighting") state = strike(state);
  assert.equal(state.pendingEvent, 2);
  state = resolveQuiz(state, false, () => 0.999999).state;
  while (state.status === "fighting") state = strike(state);
  assert.equal(state.status, "won");
  assert.equal(state.eventsTriggered, 3);
});
