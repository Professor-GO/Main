/** Wild professor levels and the level bonus on attack, defense, and speed. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  LEVEL_BONUS_PERCENT,
  WILD_LEVELS,
  createCombat,
  enemyStrike,
  levelBonus,
  levelBonuses,
  levelsOf,
  prepareSummons,
  strike,
  summon,
} from "../domain/encounterBattle.ts";
import type { CombatState } from "../domain/encounterBattle.ts";

// A professor with plenty of health, so no strike in these tests reaches a quiz checkpoint.
const PROFESSOR = { health: 10_000, attack: 400, defense: 50 };
const FIGHTER_STATS = { health: 1000, attack: 300, defense: 40, speed: 60 };

/**
 * Starts a fight against a wild professor of one level, fought by a summoned professor of another.
 * @param enemyLevel - The wild professor's level.
 * @param playerLevel - The summoned professor's level.
 * @returns The fight, ready for the first punch.
 */
function fightAt(enemyLevel: number, playerLevel: number): CombatState {
  const combat = createCombat(PROFESSOR, () => 0, enemyLevel);
  return summon(
    prepareSummons(combat, [
      {
        id: "tor-aamodt",
        name: "Tor Aamodt",
        level: playerLevel,
        stats: FIGHTER_STATS,
        defeated: false,
      },
    ]),
    "tor-aamodt",
  );
}

test("wild professors are level 10 to 100, and other levels are refused", () => {
  assert.deepEqual(WILD_LEVELS, { min: 10, max: 100 });
  for (const level of [10, 55, 100])
    assert.equal(createCombat(PROFESSOR, () => 0, level).level, level);
  for (const level of [9, 101, 10.5, Number.NaN])
    assert.throws(
      () => createCombat(PROFESSOR, () => 0, level),
      /from 10 to 100/,
    );
});

test("the higher level gets 5% more for each level above the opponent; the lower level gets nothing", () => {
  assert.equal(LEVEL_BONUS_PERCENT, 5);
  assert.equal(levelBonus(30, 10), 200);
  assert.equal(levelBonus(11, 10), 105);
  assert.equal(levelBonus(100, 1), 595);
  assert.equal(levelBonus(10, 10), 100);
  assert.equal(levelBonus(10, 30), 100);
});

test("a higher-level professor hits harder and takes less damage", () => {
  // Level 30 against level 10: the professor's attack and defense are both doubled.
  const state = fightAt(30, 10);
  assert.deepEqual(levelsOf(state), { player: 10, enemy: 30 });
  assert.deepEqual(levelBonuses(state), { player: 100, enemy: 200 });

  const hit = enemyStrike(state);
  assert.equal(hit.playerHealth, 1000 - 24);
  const struck = strike(state);
  assert.equal(struck.health, 10_000 - Math.floor(300 / (50 * 2)));
});

test("a higher-level fighter gets the bonus instead", () => {
  // Level 50 against level 10: the fighter has 300% of their attack and defense.
  const state = fightAt(10, 50);
  assert.deepEqual(levelBonuses(state), { player: 300, enemy: 100 });
  assert.equal(strike(state).health, 10_000 - Math.floor((300 * 3) / 50));
  assert.equal(enemyStrike(state).playerHealth, 1000 - 4);
});

test("fighters of the same level fight on the base stats", () => {
  const state = fightAt(25, 25);
  assert.deepEqual(levelBonuses(state), { player: 100, enemy: 100 });
  assert.equal(strike(state).health, 10_000 - Math.floor(300 / 50));
  assert.equal(enemyStrike(state).playerHealth, 1000 - 12);
});

test("the bonus is worked out exactly, with no rounding drift", () => {
  // 0.05 x 20 levels is not exact in floating point; whole percentages are.
  const combat = createCombat(
    { health: 10_000, attack: 20, defense: 1 },
    () => 0,
    30,
  );
  const state = summon(
    prepareSummons(combat, [
      {
        id: "t",
        name: "T",
        level: 10,
        stats: { ...FIGHTER_STATS, defense: 2 },
        defeated: false,
      },
    ]),
    "t",
  );
  // 20 x 200% / 2 x 120% is exactly 24.
  assert.equal(enemyStrike(state).playerHealth, 1000 - 24);
});

test("battles without a level (saved before levels, or base-rule tests) give no bonus", () => {
  const legacy = createCombat(PROFESSOR, () => 0);
  assert.equal(legacy.level, undefined);
  assert.deepEqual(levelsOf(legacy), { player: 1, enemy: null });
  assert.deepEqual(levelBonuses(legacy), { player: 100, enemy: 100 });
});

test("a newly summoned reserve brings their own level to the fight", () => {
  const combat = createCombat(PROFESSOR, () => 0, 40);
  const ready = prepareSummons(combat, [
    {
      id: "low",
      name: "Low",
      level: 10,
      stats: FIGHTER_STATS,
      defeated: false,
    },
    {
      id: "high",
      name: "High",
      level: 60,
      stats: FIGHTER_STATS,
      defeated: false,
    },
  ]);
  assert.deepEqual(levelBonuses(summon(ready, "low")), {
    player: 100,
    enemy: 250,
  });
  assert.deepEqual(levelBonuses(summon(ready, "high")), {
    player: 200,
    enemy: 100,
  });
});
