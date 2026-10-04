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

// An inventory row as SQLite returns it.
type InventoryRow = { professor_id: string; level: number; copies: number; obtained_at: string };

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
export function inventoryFor(db: DatabaseSync, userId: number): InventoryItem[] {
    const rows = db.prepare("SELECT professor_id, level, copies, obtained_at FROM inventory WHERE user_id = ? ORDER BY id")
        .all(userId) as InventoryRow[];
    return rows.map(toInventoryItem).filter((item) => item !== undefined);
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
export function pullProfessor(db: DatabaseSync, userId: number, random: () => number = Math.random): { item: InventoryItem; isNew: boolean; tokens: number } | undefined {
    db.exec("BEGIN IMMEDIATE");
    try {
        const balance = db.prepare("UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ? RETURNING tokens")
            .get(PULL_COST, userId, PULL_COST) as { tokens: number } | undefined;
        if (!balance) {
            db.exec("ROLLBACK");
            return undefined;
        }
        const professor = pickProfessor(GACHA_POOL, random);
        const row = db.prepare(`
            INSERT INTO inventory (user_id, professor_id) VALUES (?, ?)
            ON CONFLICT (user_id, professor_id) DO UPDATE SET copies = copies + 1
            RETURNING professor_id, level, copies, obtained_at
        `).get(userId, professor.id) as InventoryRow;
        db.exec("COMMIT");
        // New professors start with 1 copy, and a duplicate always brings the count to at least 2.
        return { item: { level: row.level, copies: row.copies, obtainedAt: row.obtained_at, professor }, isNew: row.copies === 1, tokens: balance.tokens };
    } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
    }
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
export function levelUpProfessor(db: DatabaseSync, userId: number, professorId: string): { item: InventoryItem; levelledUp: boolean } | undefined {
    const professor = GACHA_POOL.find((candidate) => candidate.id === professorId);
    if (!professor) return undefined;
    const levelled = db.prepare(`
        UPDATE inventory SET level = level + 1, copies = copies - ?
        WHERE user_id = ? AND professor_id = ? AND copies > ?
        RETURNING professor_id, level, copies, obtained_at
    `).get(professor.copiesToLevelUp, userId, professorId, professor.copiesToLevelUp) as InventoryRow | undefined;
    if (levelled) return { item: { level: levelled.level, copies: levelled.copies, obtainedAt: levelled.obtained_at, professor }, levelledUp: true };
    const current = db.prepare("SELECT professor_id, level, copies, obtained_at FROM inventory WHERE user_id = ? AND professor_id = ?")
        .get(userId, professorId) as InventoryRow | undefined;
    return current && { item: { level: current.level, copies: current.copies, obtainedAt: current.obtained_at, professor }, levelledUp: false };
}
