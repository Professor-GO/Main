import type { DatabaseSync } from "node:sqlite";
import { DEPARTMENTS, PROFESSOR_POOL } from "./Professor Pool/professors.ts";
import type { ProfessorEntry } from "./Professor Pool/professors.ts";

// Tokens spent on each recruitment pull.
export const PULL_COST = 10;

export type Rarity = "Common" | "Rare" | "Epic" | "Legendary";

export type Professor = ProfessorEntry & {
    rarity: Rarity;
    // Probability of this professor being pulled, from 0 to 1. The pool's chances add up to 1.
    pullChance: number;
};

/**
 * Decides a professor's rarity tier from their rating. Better-rated professors
 * are harder to pull, so they are also rarer.
 * @param avgRating - The professor's average student rating, from 1 to 5.
 * @returns "Legendary" from 4.5, "Epic" from 4.0, "Rare" from 3.0, otherwise "Common".
 */
export function rarityFor(avgRating: number): Rarity {
    if (avgRating >= 4.5) return "Legendary";
    if (avgRating >= 4) return "Epic";
    if (avgRating >= 3) return "Rare";
    return "Common";
}

/**
 * Checks the roster for mistakes and works out each professor's rarity and pull
 * chance. Each chance is proportional to the inverse of the professor's average
 * rating, and all the chances add up to 1.
 * @param entries - The roster to prepare, such as PROFESSOR_POOL from professors.ts.
 * @returns A copy of every entry with its `rarity` and `pullChance` added, in the same order.
 * @throws Error if the roster is empty, or an entry has a repeated id, a rating outside
 * 1–5, an unknown department, or a stat that is not a positive whole number.
 */
export function buildPool(entries: readonly ProfessorEntry[]): Professor[] {
    const ids = new Set<string>();
    for (const professor of entries) {
        const problem = ids.has(professor.id) ? "has a duplicate id"
            : !(professor.avgRating >= 1 && professor.avgRating <= 5) ? "needs an avgRating from 1 to 5"
            : !DEPARTMENTS.includes(professor.department) ? "has an unknown department"
            : !Object.values(professor.stats).every((stat) => Number.isInteger(stat) && stat > 0) ? "needs positive whole-number stats"
            : undefined;
        if (problem) throw new Error(`Professor "${professor.id}" ${problem}.`);
        ids.add(professor.id);
    }
    if (!entries.length) throw new Error("The professor pool is empty.");
    const totalWeight = entries.reduce((sum, professor) => sum + 1 / professor.avgRating, 0);
    return entries.map((professor) => ({
        ...professor,
        rarity: rarityFor(professor.avgRating),
        pullChance: 1 / professor.avgRating / totalWeight,
    }));
}

export const GACHA_POOL: readonly Professor[] = buildPool(PROFESSOR_POOL);

/**
 * Draws one professor at random, using each professor's pull chance as their odds.
 * It only picks a professor; it does not spend tokens or save anything.
 * @param pool - The professors to draw from. Defaults to the full gacha pool.
 * @param random - Returns a number from 0 (inclusive) to 1 (exclusive). Defaults to
 * Math.random; tests pass a fixed value to get a predictable professor.
 * @returns The professor that was drawn.
 */
export function pickProfessor(pool: readonly Professor[] = GACHA_POOL, random: () => number = Math.random): Professor {
    let roll = random();
    for (const professor of pool) {
        roll -= professor.pullChance;
        if (roll < 0) return professor;
    }
    // Floating-point rounding can leave a tiny remainder after the last professor.
    return pool[pool.length - 1];
}

/**
 * Performs one recruitment pull for a player: spends PULL_COST tokens, draws a
 * professor, and saves it to the player's collection. All of this happens in one
 * transaction, so tokens are never spent without a professor being saved.
 * @param db - The open game database.
 * @param userId - The id of the player who is pulling.
 * @param random - Passed to pickProfessor; defaults to Math.random.
 * @returns The drawn professor and the player's token balance after paying, or
 * undefined, with nothing changed, if the player has fewer than PULL_COST tokens.
 */
export function pullProfessor(db: DatabaseSync, userId: number, random: () => number = Math.random): { professor: Professor; tokens: number } | undefined {
    db.exec("BEGIN IMMEDIATE");
    try {
        const balance = db.prepare("UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ? RETURNING tokens")
            .get(PULL_COST, userId, PULL_COST) as { tokens: number } | undefined;
        if (!balance) {
            db.exec("ROLLBACK");
            return undefined;
        }
        const professor = pickProfessor(GACHA_POOL, random);
        db.prepare("INSERT INTO user_professors (user_id, professor_id) VALUES (?, ?)").run(userId, professor.id);
        db.exec("COMMIT");
        return { professor, tokens: balance.tokens };
    } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
    }
}
