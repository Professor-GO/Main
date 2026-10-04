import test from "node:test";
import assert from "node:assert/strict";
import { battleBeats } from "../battleAnimation.ts";
import type { BattleView } from "../../world/battleApi.ts";

const battle: BattleView = {
  id: "fight-1",
  professorId: "frank-wood",
  professorName: "Frank Wood",
  version: 0,
  health: 50,
  maxHealth: 50,
  playerHealth: 100,
  playerMaxHealth: 100,
  status: "fighting",
  eventsTriggered: 0,
  eventNumber: null,
  question: null,
  feedback: null,
};
test("animation beats follow real damage and omit counterattacks during a quiz interruption", () => {
  assert.deepEqual(
    battleBeats(battle, {
      ...battle,
      version: 1,
      health: 43,
      playerHealth: 98,
    }),
    ["playerAttack", "enemyAttack"],
  );
  assert.deepEqual(
    battleBeats(battle, {
      ...battle,
      version: 1,
      health: 35,
      status: "question",
      eventsTriggered: 1,
    }),
    ["playerAttack"],
  );
});
test("question loads and idempotent retries cannot replay an attack or healing", () => {
  const waiting = {
    ...battle,
    version: 1,
    health: 35,
    status: "question" as const,
  };
  assert.deepEqual(
    battleBeats(waiting, {
      ...waiting,
      question: {
        id: "q",
        source: "fallback",
        topic: "arrays",
        difficulty: "easy",
        question: "Question",
        choices: ["a", "b", "c", "d"],
        expiresAt: 10000,
      },
    }),
    [],
  );
  assert.deepEqual(battleBeats(waiting, waiting), []);
  assert.deepEqual(battleBeats(waiting, battle), []);
});
test("wrong answers animate healing before deferred strike damage and the professor's reply", () => {
  const before = {
    ...battle,
    version: 1,
    health: 35,
    status: "question" as const,
  };
  const after: BattleView = {
    ...battle,
    version: 2,
    health: 42,
    playerHealth: 98,
    feedback: {
      correct: false,
      timedOut: true,
      answerIndex: 0,
      explanation: "",
      healed: 9,
      healingPercent: 60,
    },
  };
  assert.deepEqual(battleBeats(before, after), [
    "heal",
    "enemyHit",
    "enemyAttack",
  ]);
  assert.deepEqual(
    battleBeats(before, {
      ...after,
      health: 35,
      feedback: { ...after.feedback!, correct: true, healed: 0 },
    }),
    ["enemyAttack"],
  );
});
test("victory, defeat and fleeing are terminal visual states without a demo respawn", () => {
  assert.deepEqual(
    battleBeats(battle, { ...battle, version: 1, health: 0, status: "won" }),
    ["playerAttack", "won"],
  );
  assert.deepEqual(
    battleBeats(battle, {
      ...battle,
      version: 1,
      health: 43,
      playerHealth: 0,
      status: "lost",
    }),
    ["playerAttack", "enemyAttack", "lost"],
  );
  assert.deepEqual(
    battleBeats(battle, { ...battle, version: 1, status: "fled" }),
    ["fled"],
  );
  assert.deepEqual(battleBeats(null, { ...battle, status: "won" }), ["won"]);
});
