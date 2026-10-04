import test from "node:test";
import assert from "node:assert/strict";
import { attack, createBattle } from "../BackEnd/Game Engine/battle.ts";
import type { BattleProfessor } from "../BackEnd/Game Engine/battle.ts";
import { PROFESSOR_POOL } from "../BackEnd/Professor Gacha System/Professor Pool/professors.ts";

/**
 * Creates a small professor fixture for complete battles with predictable damage.
 * @param id - The professor's identifier and display name.
 * @param stats - Any stats to override for this test.
 * @returns The test professor with the requested stats.
 */
function professor(id: string, stats: Partial<BattleProfessor["stats"]> = {}): BattleProfessor {
    return { id, name: id, department: "Physics", stats: { health: 10, attack: 9, defense: 2, speed: 5, ...stats } };
}

test("the faster professor acts first, with player winning speed ties", () => {
    const player = professor("player");
    assert.equal(createBattle(player, professor("opponent", { speed: 6 })).nextTurn, "opponent");
    assert.equal(createBattle(player, professor("opponent", { speed: 4 })).nextTurn, "player");
    assert.equal(createBattle(player, professor("opponent")).nextTurn, "player");
    assert.throws(() => attack(createBattle(player, professor("opponent")), "opponent"), /not this professor's turn/);
});

test("attacks use the defender's defense, alternate turns, and do not mutate prior state", () => {
    const player = professor("player", { attack: 10, defense: 3 });
    const opponent = professor("opponent", { attack: 11, defense: 4 });
    const battle = createBattle(player, opponent);
    const first = attack(battle, "player");
    assert.equal(first.event.damage, 2);
    assert.equal(first.battle.combatants.opponent.currentHealth, 8);
    assert.equal(first.battle.nextTurn, "opponent");
    assert.equal(first.battle.turn, 1);
    assert.equal(battle.combatants.opponent.currentHealth, 10);
    assert.equal(battle.turn, 0);
    assert.equal(opponent.stats.health, 10);
    const second = attack(first.battle, "opponent");
    assert.equal(second.event.damage, 3);
    assert.equal(second.battle.combatants.player.currentHealth, 7);
    assert.equal(second.battle.nextTurn, "player");
    assert.equal(second.battle.turn, 2);
});

test("a complete fight ends at zero health and rejects further attacks", () => {
    let battle = createBattle(professor("player"), professor("opponent"));
    while (battle.nextTurn !== null) {
        battle = attack(battle, battle.nextTurn).battle;
        assert.ok(battle.turn <= 5);
    }
    assert.equal(battle.status, "won");
    assert.equal(battle.winner, "player");
    assert.equal(battle.combatants.opponent.currentHealth, 0);
    assert.equal(battle.combatants.player.currentHealth, 2);
    assert.throws(() => attack(battle, "player"), /already ended/);
});

test("fatal overkill records only the health actually lost", () => {
    const result = attack(createBattle(professor("player", { attack: 100 }), professor("opponent", { health: 3 })), "player");
    assert.equal(result.event.damage, 50);
    assert.equal(result.event.healthLost, 3);
    assert.equal(result.event.remainingHealth, 0);
    assert.equal(result.event.defeated, true);
    assert.equal(result.battle.winner, "player");
});

test("zero damage still changes turns; a fight where neither can hurt the other is a draw", () => {
    const player = professor("player", { attack: 1 });
    const opponent = professor("opponent");
    const result = attack(createBattle(player, opponent), "player");
    assert.equal(result.event.damage, 0);
    assert.equal(result.battle.combatants.opponent.currentHealth, 10);
    assert.equal(result.battle.nextTurn, "opponent");
    const draw = createBattle(player, professor("opponent", { attack: 1 }));
    assert.equal(draw.status, "draw");
    assert.equal(draw.winner, null);
    assert.equal(draw.nextTurn, null);
    assert.throws(() => attack(draw, "player"), /already ended/);
});

test("battle health is isolated between battles and from shared roster stats", () => {
    const first = createBattle(PROFESSOR_POOL[0], PROFESSOR_POOL[1]);
    const second = createBattle(PROFESSOR_POOL[0], PROFESSOR_POOL[1]);
    assert.ok(first.nextTurn);
    const result = attack(first, first.nextTurn);
    const defender = result.event.defender;
    assert.ok(result.battle.combatants[defender].currentHealth < first.combatants[defender].currentHealth);
    assert.deepEqual(first, second);
    assert.equal(PROFESSOR_POOL[0].stats.health, 95);
    assert.equal(PROFESSOR_POOL[1].stats.health, 90);
    const levelled = createBattle({ ...PROFESSOR_POOL[0], level: 7 }, PROFESSOR_POOL[1]);
    assert.equal(levelled.combatants.player.level, 7);
    assert.equal(levelled.combatants.player.attack, PROFESSOR_POOL[0].stats.attack);
});

test("invalid stats and defeated combatants are rejected", () => {
    for (const stats of [{ health: 0 }, { defense: 0 }, { attack: -1 }, { speed: Infinity }]) {
        assert.throws(() => createBattle(professor("player", stats), professor("opponent")), RangeError);
    }
    assert.throws(() => createBattle({ ...professor("player"), level: 0 }, professor("opponent")), RangeError);
    const battle = createBattle(professor("player"), professor("opponent"));
    assert.throws(() => attack({ ...battle, combatants: { ...battle.combatants, player: { ...battle.combatants.player, currentHealth: 0 } } }, "player"), /defeated professor/);
});
