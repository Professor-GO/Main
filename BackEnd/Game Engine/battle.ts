import type { ProfessorEntry } from "../Professor Gacha System/Professor Pool/professors.ts";
import { calculateDamage, resolveHit, validateCombatValue } from "./damage.ts";
import type { DamageResult } from "./damage.ts";

export type BattleSide = "player" | "opponent";

/** The professor and optional inventory level entering a fight. Level does not scale stats yet. */
export type BattleProfessor = Pick<ProfessorEntry, "id" | "name" | "department" | "stats"> & { level?: number };

/** A battle's independent snapshot of one professor's stats and remaining health. */
export type Combatant = Readonly<{
    professorId: string;
    name: string;
    department: ProfessorEntry["department"];
    level: number;
    maxHealth: number;
    currentHealth: number;
    attack: number;
    defense: number;
    speed: number;
}>;

/** Battle rules are separate from HTTP, accounts, and database storage. */
export type BattleState = Readonly<{
    combatants: Readonly<Record<BattleSide, Combatant>>;
    status: "active" | "won" | "draw";
    nextTurn: BattleSide | null;
    winner: BattleSide | null;
    // Number of attacks already resolved. A new battle starts at zero.
    turn: number;
}>;

export type AttackEvent = Readonly<DamageResult & {
    turn: number;
    attacker: BattleSide;
    defender: BattleSide;
}>;

/**
 * Creates a combat snapshot without changing the shared professor roster or inventory.
 * @param professor - The professor entering the fight, with an optional inventory level.
 * @returns A combatant at full health with independent copies of their stats.
 * @throws RangeError if health/defense/level are not positive safe integers, or attack/speed are invalid.
 */
function createCombatant(professor: BattleProfessor): Combatant {
    const { health, attack, defense, speed } = professor.stats;
    const level = professor.level ?? 1;
    validateCombatValue(health, "Maximum health", 1);
    validateCombatValue(attack, "Attack");
    validateCombatValue(defense, "Defense", 1);
    validateCombatValue(speed, "Speed");
    validateCombatValue(level, "Level", 1);
    return { professorId: professor.id, name: professor.name, department: professor.department, level, maxHealth: health, currentHealth: health, attack, defense, speed };
}

/**
 * Creates a turn-based, one-on-one professor battle. The faster professor acts first;
 * a speed tie gives the player the first turn. If neither can deal damage, the battle is a draw.
 * @param player - The player's professor and optional inventory level.
 * @param opponent - The opponent's professor and optional inventory level.
 * @returns The new battle, with full health and no attacks resolved.
 * @throws RangeError for invalid combat stats.
 */
export function createBattle(player: BattleProfessor, opponent: BattleProfessor): BattleState {
    const combatants = { player: createCombatant(player), opponent: createCombatant(opponent) };
    const draw = calculateDamage(combatants.player.attack, combatants.opponent.defense) === 0
        && calculateDamage(combatants.opponent.attack, combatants.player.defense) === 0;
    return {
        combatants,
        status: draw ? "draw" : "active",
        nextTurn: draw ? null : combatants.player.speed >= combatants.opponent.speed ? "player" : "opponent",
        winner: null,
        turn: 0,
    };
}

/**
 * Resolves one attack, deducts the opponent's health, then changes turns or declares a winner.
 * A professor at zero health cannot act, and completed battles reject further attacks.
 * @param battle - The current battle state, which is not changed.
 * @param attacker - The side taking its turn.
 * @returns A new battle state and an event describing the damage and remaining health.
 * @throws Error if the battle is over, it is the wrong side's turn, or a combatant is defeated.
 * @throws RangeError if the state contains invalid health, stats, or a turn count.
 */
export function attack(battle: BattleState, attacker: BattleSide): { battle: BattleState; event: AttackEvent } {
    if (battle.status !== "active") throw new Error("This battle has already ended.");
    if (attacker !== "player" && attacker !== "opponent") throw new Error("Unknown battle side.");
    if (battle.nextTurn !== attacker) throw new Error("It is not this professor's turn.");
    validateCombatValue(battle.turn, "Turn count");
    if (battle.turn === Number.MAX_SAFE_INTEGER) throw new RangeError("The battle has reached its maximum turn count.");
    const defender = attacker === "player" ? "opponent" : "player";
    const attackingProfessor = battle.combatants[attacker];
    const defendingProfessor = battle.combatants[defender];
    if (attackingProfessor.currentHealth <= 0 || defendingProfessor.currentHealth <= 0) {
        throw new Error("A defeated professor cannot continue fighting.");
    }
    validateCombatValue(attackingProfessor.currentHealth, "Attacker health", 1);
    const hit = resolveHit(defendingProfessor.currentHealth, attackingProfessor.attack, defendingProfessor.defense);
    const turn = battle.turn + 1;
    return {
        battle: {
            ...battle,
            combatants: { ...battle.combatants, [defender]: { ...defendingProfessor, currentHealth: hit.remainingHealth } },
            status: hit.defeated ? "won" : "active",
            winner: hit.defeated ? attacker : null,
            nextTurn: hit.defeated ? null : defender,
            turn,
        },
        event: { ...hit, turn, attacker, defender },
    };
}
