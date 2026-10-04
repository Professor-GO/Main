import test from "node:test";
import assert from "node:assert/strict";
import {
  createCombat,
  prepareSummons,
  summon,
  enemyStrike,
  strike,
  resolveQuiz,
} from "../../../../../BackEnd/Game Engine/encounterBattle.ts";
import type { SummonFighter } from "../../../../../BackEnd/Game Engine/encounterBattle.ts";

const fighters: SummonFighter[] = [
  {
    id: "one",
    name: "One",
    level: 2,
    defeated: false,
    stats: { health: 40, attack: 80, defense: 2, speed: 60 },
  },
  {
    id: "two",
    name: "Two",
    level: 1,
    defeated: false,
    stats: { health: 70, attack: 100, defense: 5, speed: 80 },
  },
];
const prepared = () =>
  prepareSummons(
    createCombat({ health: 200, attack: 100, defense: 10 }, () => 0),
    fighters,
  );

test("combat waits for an owned professor and rejects punches and unowned summons", () => {
  const state = prepared();
  assert.equal(state.status, "summoning");
  assert.equal(state.playerHealth, 0);
  assert.throws(() => strike(state));
  assert.throws(() => enemyStrike(state));
  assert.throws(() => summon(state, "unowned"));
  const live = summon(state, "two");
  assert.equal(live.activeProfessorId, "two");
  assert.equal(live.playerHealth, 70);
  assert.equal(strike(live).health, 190);
  assert.equal(enemyStrike(live).playerHealth, 50);
  assert.equal(state.activeProfessorId, undefined);
  assert.throws(() => summon(live, "one"));
});

test("a knockout offers reserves without resetting enemy health or quiz progress; exhaustion loses", () => {
  let state = summon(prepared(), "one");
  state.health = 120;
  state.eventsTriggered = 1;
  const knocked = enemyStrike(state);
  assert.equal(knocked.playerHealth, 0);
  assert.equal(knocked.status, "summoning");
  assert.equal(knocked.fighters?.[0].defeated, true);
  assert.equal(fighters[0].defeated, false);
  assert.throws(() => summon(knocked, "one"));
  state = summon(knocked, "two");
  assert.equal(state.health, 120);
  assert.equal(state.eventsTriggered, 1);
  assert.deepEqual(state.checkpoints, knocked.checkpoints);
  assert.equal(state.playerHealth, 70);
  for (let i = 0; i < 4; i++) state = enemyStrike(state);
  assert.equal(state.status, "lost");
  assert.equal(state.playerHealth, 0);
  assert.ok(state.fighters?.every((fighter) => fighter.defeated));
  assert.throws(() => summon(state, "two"));
});

test("quiz penalties apply to the active professor and do not consume reserves", () => {
  const state = {
    ...summon(prepared(), "two"),
    status: "question" as const,
    pendingEvent: 0,
    eventsTriggered: 1,
    remainingDamage: 0,
    health: 134,
  };
  const result = resolveQuiz(state, false, () => 0);
  assert.equal(result.playerDamage, 56);
  assert.equal(result.state.playerHealth, 14);
  assert.equal(result.state.activeProfessorId, "two");
  assert.ok(result.state.fighters?.every((fighter) => !fighter.defeated));
});

test("an empty collection remains paused and cannot summon an invented fighter", () => {
  const state = prepareSummons(
    createCombat({ health: 100, attack: 20, defense: 10 }),
    [],
  );
  assert.equal(state.status, "summoning");
  assert.throws(() => summon(state, "student"));
});

test("low-attack professors still deal at least one damage in both directions", () => {
  const state = summon(
    prepareSummons(
      createCombat({ health: 100, attack: 1, defense: 100 }, () => 0),
      [
        {
          ...fighters[0],
          stats: { ...fighters[0].stats, attack: 1, defense: 100 },
        },
      ],
    ),
    "one",
  );
  assert.equal(strike(state).health, 99);
  assert.equal(enemyStrike(state).playerHealth, 39);
});
