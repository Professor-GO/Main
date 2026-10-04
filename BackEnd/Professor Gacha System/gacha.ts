import type { DatabaseSync } from "node:sqlite";
import { DEPARTMENTS, PROFESSOR_POOL } from "./Professor Pool/professors.ts";
import type { ProfessorEntry } from "./Professor Pool/professors.ts";

// Tokens spent on each recruitment pull.
export const PULL_COST = 10;

// Chance of a pull being a Legendary professor before pity raises it.
export const LEGENDARY_CHANCE = 0.0008;
// The Legendary chance stays at LEGENDARY_CHANCE for this many pulls without one, then rises
// in a straight line until the pull numbered LEGENDARY_HARD_PITY, which is always Legendary.
export const LEGENDARY_SOFT_PITY = 50;
export const LEGENDARY_HARD_PITY = 80;
// Chance of a pull being an Epic professor. Every EPIC_PITY-th pull without one is always Epic.
export const EPIC_CHANCE = 0.05;
export const EPIC_PITY = 10;

export type Rarity = "Common" | "Rare" | "Epic" | "Legendary";

export type Professor = ProfessorEntry & {
    rarity: Rarity;
    // Probability of this professor being pulled before pity, from 0 to 1. Only Legendary and
    // Epic professors can be pulled, so it is 0 for everyone else.
    pullChance: number;
};

// An item that fills every pull that is not a professor.
export type Cage = {
    id: string;
    name: string;
    image: string;
    // Share of the cage pulls this cage takes, relative to the other cages.
    weight: number;
    // Probability of this cage being pulled before pity, from 0 to 1.
    pullChance: number;
};

// How many pulls in a row a player has made without a Legendary and without an Epic professor.
export type Pity = { legendary: number; epic: number };

// What one pull can give: a professor or a cage.
export type Prize = { kind: "professor"; professor: Professor } | { kind: "cage"; cage: Cage };

// Golden, iron, and bronze cages share the non-professor pulls in a 1 : 5 : 10 ratio.
const CAGE_WEIGHTS = [
    { id: "golden-cage", name: "Golden Cage", image: "/Assets/gacha/cage_gold.png", weight: 1 },
    { id: "iron-cage", name: "Iron Cage", image: "/Assets/gacha/cage_iron.png", weight: 5 },
    { id: "bronze-cage", name: "Bronze Cage", image: "/Assets/gacha/cage_copper.png", weight: 10 },
];
const CAGE_WEIGHT_TOTAL = CAGE_WEIGHTS.reduce((sum, cage) => sum + cage.weight, 0);

export const GACHA_CAGES: readonly Cage[] = CAGE_WEIGHTS.map((cage) => ({
    ...cage,
    pullChance: (1 - LEGENDARY_CHANCE - EPIC_CHANCE) * cage.weight / CAGE_WEIGHT_TOTAL,
}));

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

// One kind of cage a player owns, and how many of it they have.
export type OwnedCage = { cage: Cage; quantity: number };

// An inventory row as SQLite returns it.
type InventoryRow = { professor_id: string; level: number; copies: number; obtained_at: string };

/**
 * Decides a professor's rarity tier from their rating. Only Legendary and Epic
 * professors can be pulled from the gacha.
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
 * chance before pity. Legendary professors share LEGENDARY_CHANCE equally and Epic
 * professors share EPIC_CHANCE equally; Rare and Common professors cannot be pulled.
 * Together with the cages in GACHA_CAGES, the chances add up to 1.
 * @param entries - The roster to prepare, such as PROFESSOR_POOL from professors.ts.
 * @returns A copy of every entry with its `rarity` and `pullChance` added, in the same order.
 * @throws Error if the roster is empty or has no Legendary or no Epic professor, or an entry
 * has a repeated id, a rating outside 1–5, an unknown department, or a stat or copiesToLevelUp
 * that is not a positive whole number.
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
    // Counts the roster's professors of one rarity.
    const count = (rarity: Rarity) => entries.filter((professor) => rarityFor(professor.avgRating) === rarity).length;
    // Pity guarantees a Legendary and an Epic professor, so the roster needs at least one of each.
    for (const rarity of ["Legendary", "Epic"] as const) {
        if (!count(rarity)) throw new Error(`The professor pool needs at least one ${rarity} professor.`);
    }
    const tierChances: Partial<Record<Rarity, number>> = { Legendary: LEGENDARY_CHANCE / count("Legendary"), Epic: EPIC_CHANCE / count("Epic") };
    return entries.map((professor) => {
        const rarity = rarityFor(professor.avgRating);
        return { ...professor, rarity, pullChance: tierChances[rarity] ?? 0 };
    });
}

export const GACHA_POOL: readonly Professor[] = buildPool(PROFESSOR_POOL);

/**
 * Works out the chance of the next pull being a Legendary professor. It is LEGENDARY_CHANCE
 * for the first LEGENDARY_SOFT_PITY pulls without a Legendary, then rises in a straight line
 * to 1 on the pull numbered LEGENDARY_HARD_PITY.
 * @param pullsWithout - How many pulls in a row the player has made without a Legendary.
 * @returns The chance, from LEGENDARY_CHANCE to 1.
 */
export function legendaryChance(pullsWithout: number): number {
    // The pull about to be made, counting from 1 since the last Legendary.
    const pull = pullsWithout + 1;
    if (pull <= LEGENDARY_SOFT_PITY) return LEGENDARY_CHANCE;
    if (pull >= LEGENDARY_HARD_PITY) return 1;
    return LEGENDARY_CHANCE + (1 - LEGENDARY_CHANCE) * (pull - LEGENDARY_SOFT_PITY) / (LEGENDARY_HARD_PITY - LEGENDARY_SOFT_PITY);
}

/**
 * Lists everything the next pull can give and the chance of each, for a player's pity.
 * The Legendary chance comes from legendaryChance(). Epic professors take EPIC_CHANCE, or
 * everything a Legendary leaves on the EPIC_PITY-th pull without an Epic. Cages take the rest.
 * @param pity - The player's pulls in a row without a Legendary and without an Epic.
 * @param pool - The professors to draw from. Defaults to the full gacha pool.
 * @returns Every Legendary professor, then every Epic professor, then every cage, each
 * with its `chance` from 0 to 1. The chances add up to 1.
 */
export function pullOdds(pity: Pity, pool: readonly Professor[] = GACHA_POOL): (Prize & { chance: number })[] {
    const legendary = legendaryChance(pity.legendary);
    const epic = pity.epic + 1 >= EPIC_PITY ? 1 - legendary : Math.min(EPIC_CHANCE, 1 - legendary);
    const cages = Math.max(0, 1 - legendary - epic);
    // Splits one rarity's chance equally between the professors of that rarity.
    const tier = (rarity: Rarity, chance: number) => {
        const professors = pool.filter((professor) => professor.rarity === rarity);
        return professors.map((professor) => ({ kind: "professor" as const, professor, chance: chance / professors.length }));
    };
    return [
        ...tier("Legendary", legendary),
        ...tier("Epic", epic),
        ...GACHA_CAGES.map((cage) => ({ kind: "cage" as const, cage, chance: cages * cage.weight / CAGE_WEIGHT_TOTAL })),
    ];
}

/**
 * Draws one prize at random, using the odds from pullOdds() for the player's pity.
 * The pool is never used up: every pull draws from all of it again.
 * It only picks a prize; it does not spend tokens or save anything.
 * @param pity - The player's pulls in a row without a Legendary and without an Epic.
 * @param random - Returns a number from 0 (inclusive) to 1 (exclusive). Defaults to
 * Math.random; tests pass a fixed value to get a predictable prize.
 * @param pool - The professors to draw from. Defaults to the full gacha pool.
 * @returns The professor or cage that was drawn.
 */
export function pickPrize(pity: Pity, random: () => number = Math.random, pool: readonly Professor[] = GACHA_POOL): Prize {
    const odds = pullOdds(pity, pool).filter((prize) => prize.chance > 0);
    let roll = random();
    for (const prize of odds) {
        roll -= prize.chance;
        if (roll < 0) return prize;
    }
    // Floating-point rounding can leave a tiny remainder after the last prize.
    return odds[odds.length - 1];
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
 * Lists the cages a player owns.
 * @param db - The open game database.
 * @param userId - The id of the player whose cages to list.
 * @returns Each kind of cage the player has at least one of, in GACHA_CAGES order.
 */
export function cagesFor(db: DatabaseSync, userId: number): OwnedCage[] {
    const rows = db.prepare("SELECT item_id, quantity FROM items WHERE user_id = ? AND quantity > 0")
        .all(userId) as { item_id: string; quantity: number }[];
    return GACHA_CAGES.flatMap((cage) => {
        const row = rows.find((candidate) => candidate.item_id === cage.id);
        return row ? [{ cage, quantity: row.quantity }] : [];
    });
}

/**
 * Reads a player's pity: their pulls in a row without a Legendary and without an Epic.
 * @param db - The open game database.
 * @param userId - The id of the player.
 * @returns The player's pity, which is 0 for both until their first pull.
 */
export function pityFor(db: DatabaseSync, userId: number): Pity {
    const row = db.prepare("SELECT legendary_pity, epic_pity FROM gacha_pity WHERE user_id = ?")
        .get(userId) as { legendary_pity: number; epic_pity: number } | undefined;
    return { legendary: row?.legendary_pity ?? 0, epic: row?.epic_pity ?? 0 };
}

/**
 * Performs one pull for a player: spends PULL_COST tokens and draws a prize using the
 * player's pity. A professor the player does not own yet joins their inventory at
 * level 1 with 1 copy; a professor they already own gains another copy instead. A cage
 * adds 1 to the player's count of that cage. Pulling a Legendary or an Epic resets that
 * rarity's pity, and every other pull adds 1 to it. All of this happens in one
 * transaction, so tokens are never spent without the prize being saved.
 * @param db - The open game database.
 * @param userId - The id of the player who is pulling.
 * @param random - Passed to pickPrize; defaults to Math.random.
 * @returns The player's token balance after paying, their pity after the pull, and the
 * prize: for a professor, their inventory item and whether they are new to the player
 * (`isNew`); for a cage, the cage and how many of it the player now has. Returns
 * undefined, with nothing changed, if the player has fewer than PULL_COST tokens.
 */
export function pullGacha(db: DatabaseSync, userId: number, random: () => number = Math.random):
    { tokens: number; pity: Pity } & ({ kind: "professor"; item: InventoryItem; isNew: boolean } | ({ kind: "cage" } & OwnedCage)) | undefined {
    db.exec("BEGIN IMMEDIATE");
    try {
        const balance = db.prepare("UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ? RETURNING tokens")
            .get(PULL_COST, userId, PULL_COST) as { tokens: number } | undefined;
        if (!balance) {
            db.exec("ROLLBACK");
            return undefined;
        }
        const before = pityFor(db, userId);
        const prize = pickPrize(before, random);
        const rarity = prize.kind === "professor" ? prize.professor.rarity : undefined;
        const pity = { legendary: rarity === "Legendary" ? 0 : before.legendary + 1, epic: rarity === "Epic" ? 0 : before.epic + 1 };
        db.prepare(`
            INSERT INTO gacha_pity (user_id, legendary_pity, epic_pity) VALUES (?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET legendary_pity = excluded.legendary_pity, epic_pity = excluded.epic_pity
        `).run(userId, pity.legendary, pity.epic);
        if (prize.kind === "cage") {
            const owned = db.prepare(`
                INSERT INTO items (user_id, item_id) VALUES (?, ?)
                ON CONFLICT (user_id, item_id) DO UPDATE SET quantity = quantity + 1
                RETURNING quantity
            `).get(userId, prize.cage.id) as { quantity: number };
            db.exec("COMMIT");
            return { kind: "cage", cage: prize.cage, quantity: owned.quantity, tokens: balance.tokens, pity };
        }
        const professor = prize.professor;
        const row = db.prepare(`
            INSERT INTO inventory (user_id, professor_id) VALUES (?, ?)
            ON CONFLICT (user_id, professor_id) DO UPDATE SET copies = copies + 1
            RETURNING professor_id, level, copies, obtained_at
        `).get(userId, professor.id) as InventoryRow;
        db.exec("COMMIT");
        // New professors start with 1 copy, and a duplicate always brings the count to at least 2.
        return { kind: "professor", item: { level: row.level, copies: row.copies, obtainedAt: row.obtained_at, professor }, isNew: row.copies === 1, tokens: balance.tokens, pity };
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
