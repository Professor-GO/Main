import type { DatabaseSync } from "node:sqlite";
import { inventoryRows, savePull, spendCopies } from "../Persistence Layer/inventory.ts";
import type { InventoryRow } from "../Persistence Layer/inventory.ts";
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

// One professor in a player's inventory, with every copy of them the player owns.
export type InventoryItem = {
    // The professor's current level, starting at 1. Raised by spending copies with levelUpProfessor().
    level: number;
    // How many copies of this professor the player owns, including the one in use. Always at least 1.
    copies: number;
    // When the player first recruited this professor (UTC).
    obtainedAt: string;
    // The professor's details from the gacha pool, including copiesToLevelUp.
    professor: Professor;
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
 * 1–5, an unknown department, or a stat or copiesToLevelUp that is not a positive whole number.
 */
export function buildPool(entries: readonly ProfessorEntry[]): Professor[] {
    const ids = new Set<string>();
    for (const professor of entries) {
        const problem = ids.has(professor.id) ? "has a duplicate id"
            : !(professor.avgRating >= 1 && professor.avgRating <= 5) ? "needs an avgRating from 1 to 5"
            : !DEPARTMENTS.includes(professor.department) ? "has an unknown department"
            : !Object.values(professor.stats).every((stat) => Number.isInteger(stat) && stat > 0) ? "needs positive whole-number stats"
            : !(Number.isInteger(professor.copiesToLevelUp) && professor.copiesToLevelUp > 0) ? "needs a positive whole-number copiesToLevelUp"
            : undefined;
        if (problem) throw new Error(`Professor "${professor.id}" ${problem}.`);
        ids.add(professor.id);
    }
    if (!entries.length) throw new Error("The professor pool is empty.");
    // TODO: might change the pulling chance formula since we just put flat pulling chance
    // Each professor's weight is 1 / avgRating, so a higher rating means a smaller weight.
    // Dividing every weight by the total turns the weights into chances that add up to 1.
    // For example, ratings 2 and 4 give weights 0.5 and 0.25 (total 0.75), so the chances
    // are 0.5 / 0.75 = 2/3 and 0.25 / 0.75 = 1/3: the 2-rated professor is twice as likely.
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
 *
 * How the draw works (weighted random selection, also called "roulette wheel" selection):
 * picture the line from 0 to 1 cut into one segment per professor, in pool order, where
 * each segment's length is that professor's pullChance. The chances add up to 1, so the
 * segments cover the whole line. A random number from 0 to 1 lands in exactly one
 * segment, and that professor is drawn. A professor with a bigger chance has a longer
 * segment, so random numbers land in it more often.
 *
 * Example with three professors whose chances are 0.2, 0.3, and 0.5:
 *   segments:  A = [0, 0.2)   B = [0.2, 0.5)   C = [0.5, 1)
 *   roll 0.65: 0.65 - 0.2 = 0.45 (not past A), 0.45 - 0.3 = 0.15 (not past B),
 *              0.15 - 0.5 = -0.35 (below 0, so the roll landed in C). C is drawn.
 *
 * Every draw is "with replacement": the pool is never changed, so every professor can
 * be drawn on every pull with the same odds, no matter what was drawn before. That is
 * how a player ends up with duplicate copies of a professor.
 *
 * @param pool - The professors to draw from. Defaults to the full gacha pool.
 * @param random - Returns a number from 0 (inclusive) to 1 (exclusive). Defaults to
 * Math.random; tests pass a fixed value to get a predictable professor.
 * @returns The professor that was drawn.
 */
export function pickProfessor(pool: readonly Professor[] = GACHA_POOL, random: () => number = Math.random): Professor {
    // Where the random number lands on the 0-to-1 line.
    let roll = random();
    for (const professor of pool) {
        // Step past this professor's segment. Only the local `roll` changes; the pool does not.
        roll -= professor.pullChance;
        // Below 0 means the roll landed inside this professor's segment.
        if (roll < 0) return professor;
    }
    // Floating-point rounding can make the chances add up to a hair under 1, leaving a
    // tiny remainder after the last professor. Such a roll belongs in the last segment.
    return pool[pool.length - 1];
}

/**
 * Combines an inventory row with the professor's details from the gacha pool.
 * @param row - The inventory row from the database.
 * @returns The inventory item, or undefined if the professor is no longer in the
 * pool (for example, because they were removed from professors.ts).
 */
function toInventoryItem(row: InventoryRow): InventoryItem | undefined {
    const professor = GACHA_POOL.find((candidate) => candidate.id === row.professor_id);
    return professor && { level: row.level, copies: row.copies, obtainedAt: row.obtained_at, professor };
}

/**
 * Lists every professor a player has recruited.
 * @param db - The open game database.
 * @param userId - The id of the player whose inventory to list.
 * @returns The player's inventory items, oldest first. Professors that are no
 * longer in the pool are left out.
 */
export function inventoryFor(db: DatabaseSync, userId: string): InventoryItem[] {
    return inventoryRows(db, userId).map(toInventoryItem).filter((item) => item !== undefined);
}

/**
 * Performs one recruitment pull for a player: spends PULL_COST tokens and draws a
 * professor. A professor the player does not own yet joins their inventory at
 * level 1 with 1 copy; a professor they already own gains another copy instead. All of
 * this happens in one transaction, so tokens are never spent without the inventory changing.
 * @param db - The open game database.
 * @param userId - The id of the player who is pulling.
 * @param random - Passed to pickProfessor; defaults to Math.random.
 * @returns The professor's inventory item after the pull, whether they are new to the
 * player (`isNew`), and the player's token balance after paying. Returns undefined,
 * with nothing changed, if the player has fewer than PULL_COST tokens.
 */
export function pullProfessor(db: DatabaseSync, userId: string, random: () => number = Math.random): { item: InventoryItem; isNew: boolean; tokens: number } | undefined {
    // Draw from the whole pool every time (with replacement), so a professor the player
    // already owns can be drawn again. The persistence layer saves that as an extra copy.
    const professor = pickProfessor(GACHA_POOL, random);
    const saved = savePull(db, userId, professor.id, PULL_COST);
    if (!saved) return undefined;
    const { row, tokens } = saved;
    // New professors start with 1 copy, and a duplicate always brings the count to at least 2.
    return { item: { level: row.level, copies: row.copies, obtainedAt: row.obtained_at, professor }, isNew: row.copies === 1, tokens };
}

/**
 * Levels up one of a player's professors by spending duplicate copies. It costs the
 * professor's copiesToLevelUp copies, and the player always keeps at least one copy,
 * so they need copiesToLevelUp + 1 copies in total.
 * @param db - The open game database.
 * @param userId - The id of the player levelling up their professor.
 * @param professorId - The id of the professor to level up.
 * @returns The professor's inventory item and whether it levelled up. `levelledUp` is
 * false, with nothing changed, if the player does not have enough copies. Returns
 * undefined if the player does not own that professor.
 */
export function levelUpProfessor(db: DatabaseSync, userId: string, professorId: string): { item: InventoryItem; levelledUp: boolean } | undefined {
    const professor = GACHA_POOL.find((candidate) => candidate.id === professorId);
    if (!professor) return undefined;
    const saved = spendCopies(db, userId, professorId, professor.copiesToLevelUp);
    if (!saved) return undefined;
    const { row, levelledUp } = saved;
    return { item: { level: row.level, copies: row.copies, obtainedAt: row.obtained_at, professor }, levelledUp };
}
