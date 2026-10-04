import test from "node:test";
import assert from "node:assert/strict";
import {
  STUDENT_STATS,
  createCombat,
  resolveQuiz,
  strike,
} from "../../../../../BackEnd/Game Engine/encounterBattle.ts";
import type { CombatState } from "../../../../../BackEnd/Game Engine/encounterBattle.ts";

// A roll of 0 puts the checkpoints at the bottom of each range. With 100 max health
// that is 67, 34, and 10 health.
const LOWEST_ROLL = () => 0;
// A roll just under 1 puts the checkpoints at the top of each range.
const HIGHEST_ROLL = () => 0.999999;

/**
 * Starts a fight whose checkpoints sit at the bottom of each range.
 * @param health - The professor's max health.
 * @param attack - The professor's attack.
 * @param defense - The professor's defense.
 * @returns The new combat state.
 */
function fight(health: number, attack: number, defense: number): CombatState {
  return createCombat({ health, attack, defense }, LOWEST_ROLL);
}

test("createCombat starts both sides at full health", () => {
  const state = fight(300, 40, 60);

  assert.equal(state.maxHealth, 300);
  assert.equal(state.health, 300);
  assert.equal(state.playerHealth, STUDENT_STATS.health);
  assert.equal(state.attack, 40);
  assert.equal(state.defense, 60);
  assert.equal(state.status, "fighting");
  assert.equal(state.eventsTriggered, 0);
  assert.equal(state.pendingEvent, null);
  assert.equal(state.remainingDamage, 0);
});

test("createCombat rolls one whole-health checkpoint inside each range", () => {
  for (const health of [100, 7, 241]) {
    const ranges = [
      [Math.ceil((health * 2) / 3), Math.floor((health * 3) / 4)],
      [Math.ceil(health / 3), Math.floor((health * 3) / 5)],
    ];
    for (const roll of [LOWEST_ROLL, () => 0.5, HIGHEST_ROLL]) {
      const { checkpoints } = createCombat(
        { health, attack: 1, defense: 1 },
        roll,
      );
      assert.equal(checkpoints.length, 3);
      ranges.forEach(([low, high], index) => {
        const checkpoint = checkpoints[index];
        assert.ok(
          Number.isInteger(checkpoint),
          `checkpoint ${index} (${checkpoint}) is not whole health`,
        );
        assert.ok(
          checkpoint >= low && checkpoint <= high,
          `checkpoint ${index} (${checkpoint}) is outside ${low}-${high} for ${health} health`,
        );
      });
      assert.equal(checkpoints[2], Math.max(1, Math.floor(health / 10)));
    }
  }
});

test("createCombat checkpoints reach both ends of each range", () => {
  assert.deepEqual(fight(100, 0, 1).checkpoints, [67, 34, 10]);
  assert.deepEqual(
    createCombat({ health: 100, attack: 0, defense: 1 }, HIGHEST_ROLL)
      .checkpoints,
    [75, 60, 10],
  );
});

test("the last checkpoint is never below 1 health", () => {
  assert.equal(fight(5, 0, 1).checkpoints[2], 1);
});

test("strike deals floor(student attack / professor defense) damage", () => {
  for (const defense of [20, 60, 80, 7]) {
    const state = strike(fight(1000, 0, defense));
    assert.equal(
      state.health,
      1000 - Math.floor(STUDENT_STATS.attack / defense),
      `defense ${defense}`,
    );
  }
});

test("higher defense means less damage taken", () => {
  const weak = strike(fight(1000, 0, 20));
  const strong = strike(fight(1000, 0, 80));
  assert.ok(strong.health > weak.health);
});

test("the professor hits back for floor(professor attack / student defense)", () => {
  for (const attack of [50, 39, 19]) {
    const state = strike(fight(1000, attack, 60));
    assert.equal(
      state.playerHealth,
      STUDENT_STATS.health - Math.floor(attack / STUDENT_STATS.defense),
      `attack ${attack}`,
    );
    assert.equal(state.status, "fighting");
  }
});

test("strike returns a new state and leaves the old one unchanged", () => {
  const before = fight(1000, 50, 60);
  const snapshot = structuredClone(before);
  const after = strike(before);

  assert.notEqual(after, before);
  assert.deepEqual(before, snapshot);
});

test("a hit that crosses a checkpoint stops there and asks a question", () => {
  // Checkpoints at 67, 34, and 10 health; each strike deals 30.
  let state = strike(fight(100, 40, 20));
  assert.equal(state.health, 70);
  assert.equal(state.playerHealth, 98);

  state = strike(state);
  assert.equal(state.health, 67);
  assert.equal(state.remainingDamage, 27);
  assert.equal(state.status, "question");
  assert.equal(state.pendingEvent, 0);
  assert.equal(state.eventsTriggered, 1);
  // The professor does not hit back while the strike is paused.
  assert.equal(state.playerHealth, 98);
});

test("strike refuses to attack while a question is waiting", () => {
  const paused = strike(strike(fight(100, 40, 20)));
  assert.throws(() => strike(paused), /Finish the current question/);
});

test("a correct answer heals nothing and finishes the paused strike", () => {
  const paused = strike(strike(fight(100, 40, 20)));
  const { state, healed, healingPercent, playerDamage } = resolveQuiz(
    paused,
    true,
  );

  assert.equal(healed, 0);
  assert.equal(healingPercent, 0);
  assert.equal(playerDamage, 0);
  assert.equal(state.health, 40);
  assert.equal(state.remainingDamage, 0);
  assert.equal(state.pendingEvent, null);
  assert.equal(state.status, "fighting");
  assert.equal(state.playerHealth, 96);
});

test("a wrong answer heals 10% to 20% of max health before the strike finishes", () => {
  // Paused at 67 of 100 health, so 27 damage is still waiting.
  const paused = strike(strike(fight(100, 40, 20)));

  const lowest = resolveQuiz(paused, false, LOWEST_ROLL);
  assert.equal(lowest.healingPercent, 10);
  assert.equal(lowest.healed, 10);
  assert.equal(lowest.state.health, 67 + 10 - 27);
  assert.equal(lowest.playerDamage, 4);
  assert.equal(lowest.state.playerHealth, 92);

  const highest = resolveQuiz(paused, false, HIGHEST_ROLL);
  assert.equal(highest.healingPercent, 20);
  assert.equal(highest.healed, 20);
  assert.equal(highest.state.health, 67 + 20 - 27);
  assert.equal(highest.playerDamage, 11);
  assert.equal(highest.state.playerHealth, 85);
});

test("the wrong-answer penalty uses current HP, rounds damage down, and does not mutate the input", () => {
  const paused = strike(strike(fight(100, 0, 20)));
  for (const health of [100, 98, 37, 5, 1]) {
    const before = { ...paused, playerHealth: health };
    const snapshot = structuredClone(before);
    const result = resolveQuiz(before, false, LOWEST_ROLL);
    assert.equal(result.playerDamage, Math.min(Math.floor((health * 5) / 100), 15));
    assert.equal(result.state.playerHealth, health - result.playerDamage);
    assert.deepEqual(before, snapshot);
  }
});

test("the penalty can lead to defeat when the professor counterattacks", () => {
  const paused = { ...strike(strike(fight(100, 40, 20))), playerHealth: 5 };
  const result = resolveQuiz(paused, false, LOWEST_ROLL);
  assert.equal(result.playerDamage, 0);
  assert.equal(result.healed, 10);
  assert.equal(result.state.playerHealth, 3);
  assert.equal(result.state.status, "fighting");
});

test("wrong answers still cost health when deferred damage reaches another quiz or wins the fight", () => {
  const paused = strike(fight(100, 40, 1));
  const first = resolveQuiz(paused, false, LOWEST_ROLL);
  assert.equal(first.playerDamage, 5);
  assert.equal(first.state.playerHealth, 95);
  assert.equal(first.state.status, "question");
  const second = resolveQuiz(first.state, false, LOWEST_ROLL);
  assert.equal(second.playerDamage, 4);
  assert.equal(second.state.playerHealth, 91);
  const third = resolveQuiz(second.state, false, LOWEST_ROLL);
  assert.equal(third.playerDamage, 4);
  assert.equal(third.state.playerHealth, 87);
  assert.equal(third.state.status, "won");
});

test("resolveQuiz refuses when no question is waiting", () => {
  assert.throws(() => resolveQuiz(fight(100, 40, 20), true), /no question/);
});

test("a lethal hit cannot skip any question", () => {
  // 600 damage against 100 health would end the fight at once without checkpoints.
  let state = strike(fight(100, 40, 1));
  const stops: number[] = [];
  while (state.status === "question") {
    stops.push(state.health);
    state = resolveQuiz(state, true).state;
  }

  assert.deepEqual(stops, [67, 34, 10]);
  assert.equal(state.health, 0);
  assert.equal(state.status, "won");
  assert.equal(state.eventsTriggered, 3);
  // A knocked-out professor does not hit back.
  assert.equal(state.playerHealth, STUDENT_STATS.health);
});

test("professor health never drops below zero", () => {
  let state = fight(100, 0, 1);
  while (state.status !== "won") {
    state =
      state.status === "question"
        ? resolveQuiz(state, true).state
        : strike(state);
    assert.ok(state.health >= 0);
  }
  assert.equal(state.health, 0);
});

test("the player loses when their health reaches zero", () => {
  const state = strike(fight(1000, 5000, 60));

  assert.equal(state.playerHealth, 0);
  assert.equal(state.status, "lost");
  assert.throws(() => strike(state), /Finish the current question/);
});
