import type { DatabaseSync } from "node:sqlite";
import { inventoryRows, pityRow, savePull, spendCopies } from "../Persistence Layer/inventory.ts";
import type { InventoryRow } from "../Persistence Layer/inventory.ts";
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
// Chance of a pull being an Epic professor. The EPIC_PITY-th pull in a row without an Epic
// or a Legendary is always one of the two (Epic, unless it rolls a Legendary).
export const EPIC_CHANCE = 0.05;
export const EPIC_PITY = 10;

export type Rarity = "Common" | "Rare" | "Epic" | "Legendary";

// Chance of a pull being a Rare or Common professor before pity: everything the
// Legendary and Epic professors leave.
export const STANDARD_CHANCE = 1 - LEGENDARY_CHANCE - EPIC_CHANCE;

// The cage a pulled professor arrives in. Its look shows the professor's rarity.
export type Cage = { id: string; name: string; image: string };

export type Professor = ProfessorEntry & {
    rarity: Rarity;
    // The cage this professor arrives in, from their rarity (see CAGES).
    cage: Cage;
    // Probability of this professor being pulled before pity, from 0 to 1. Legendary
    // professors share LEGENDARY_CHANCE, Epic professors share EPIC_CHANCE, and Rare and
    // Common professors share STANDARD_CHANCE, so every pull is a professor.
    pullChance: number;
};

// A player's pity: `legendary` counts their pulls in a row without a Legendary professor, and
// `epic` counts their pulls in a row without an Epic or a Legendary professor.
export type Pity = { legendary: number; epic: number };

// Legendary professors arrive in a golden cage, Epic in an iron cage, and Rare and Common in a bronze cage.
const GOLDEN_CAGE: Cage = { id: "golden-cage", name: "Golden Cage", image: "/Assets/gacha/cage_gold.png" };
const IRON_CAGE: Cage = { id: "iron-cage", name: "Iron Cage", image: "/Assets/gacha/cage_iron.png" };
const BRONZE_CAGE: Cage = { id: "bronze-cage", name: "Bronze Cage", image: "/Assets/gacha/cage_copper.png" };
export const CAGES: Readonly<Record<Rarity, Cage>> = { Legendary: GOLDEN_CAGE, Epic: IRON_CAGE, Rare: BRONZE_CAGE, Common: BRONZE_CAGE };

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
 * Decides a professor's rarity tier from their rating.
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
 * Checks the roster for mistakes and works out each professor's rarity, cage, and pull
 * chance before pity. Legendary professors share LEGENDARY_CHANCE equally, Epic professors
 * share EPIC_CHANCE equally, and Rare and Common professors share STANDARD_CHANCE equally,
 * so the chances add up to 1.
 * @param entries - The roster to prepare, such as PROFESSOR_POOL from professors.ts.
 * @returns A copy of every entry with its `rarity`, `cage`, and `pullChance` added, in the same order.
 * @throws Error if the roster is empty, has no Legendary, no Epic, or no Rare or Common
 * professor, or an entry has a repeated id, a rating outside 1–5, an unknown department,
 * or a stat or copiesToLevelUp that is not a positive whole number.
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
    // Every other pull is a Rare or Common professor, so the roster needs at least one of those too.
    const standard = count("Rare") + count("Common");
    if (!standard) throw new Error("The professor pool needs at least one Rare or Common professor.");
    const tierChances: Record<Rarity, number> = {
        Legendary: LEGENDARY_CHANCE / count("Legendary"),
        Epic: EPIC_CHANCE / count("Epic"),
        Rare: STANDARD_CHANCE / standard,
        Common: STANDARD_CHANCE / standard,
    };
    return entries.map((professor) => {
        const rarity = rarityFor(professor.avgRating);
        return { ...professor, rarity, cage: CAGES[rarity], pullChance: tierChances[rarity] };
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
 * Lists every professor the next pull can give and the chance of each, for a player's pity.
 * The Legendary chance comes from legendaryChance(). Epic professors take EPIC_CHANCE, or
 * everything a Legendary leaves on the EPIC_PITY-th pull without an Epic. Rare and Common
 * professors take the rest.
 * @param pity - The player's pity (see the Pity type).
 * @param pool - The professors to draw from. Defaults to the full gacha pool.
 * @returns Every Legendary professor, then every Epic professor, then every Rare and Common
 * professor (in pool order), each with its `chance` from 0 to 1. The chances add up to 1.
 */
export function pullOdds(pity: Pity, pool: readonly Professor[] = GACHA_POOL): { professor: Professor; chance: number }[] {
    const legendary = legendaryChance(pity.legendary);
    const epic = pity.epic + 1 >= EPIC_PITY ? 1 - legendary : Math.min(EPIC_CHANCE, 1 - legendary);
    const standard = Math.max(0, 1 - legendary - epic);
    // Splits one tier's chance equally between the professors of the given rarities.
    const tier = (rarities: readonly Rarity[], chance: number) => {
        const professors = pool.filter((professor) => rarities.includes(professor.rarity));
        return professors.map((professor) => ({ professor, chance: chance / professors.length }));
    };
    return [
        ...tier(["Legendary"], legendary),
        ...tier(["Epic"], epic),
        ...tier(["Rare", "Common"], standard),
    ];
}

/**
 * Draws one professor at random, using the odds from pullOdds() for the player's pity.
 * It only picks a professor; it does not spend tokens or save anything.
 *
 * How the draw works (weighted random selection, also called "roulette wheel" selection):
 * picture the line from 0 to 1 cut into one segment per professor, in pullOdds() order, where
 * each segment's length is that professor's chance. The chances add up to 1, so the
 * segments cover the whole line. A random number from 0 to 1 lands in exactly one
 * segment, and that professor is drawn. A professor with a bigger chance has a longer
 * segment, so random numbers land in it more often.
 *
 * Every draw is "with replacement": the pool is never used up, so every professor can
 * be drawn on every pull, no matter what was drawn before. That is how a player ends
 * up with duplicate copies of a professor.
 *
 * @param pity - The player's pity (see the Pity type).
 * @param random - Returns a number from 0 (inclusive) to 1 (exclusive). Defaults to
 * Math.random; tests pass a fixed value to get a predictable professor.
 * @param pool - The professors to draw from. Defaults to the full gacha pool.
 * @returns The professor that was drawn. Their `cage` is the cage they arrive in.
 */
export function pickProfessor(pity: Pity, random: () => number = Math.random, pool: readonly Professor[] = GACHA_POOL): Professor {
    const odds = pullOdds(pity, pool).filter((option) => option.chance > 0);
    // Where the random number lands on the 0-to-1 line.
    let roll = random();
    for (const option of odds) {
        // Step past this professor's segment. Only the local `roll` changes; the pool does not.
        roll -= option.chance;
        // Below 0 means the roll landed inside this professor's segment.
        if (roll < 0) return option.professor;
    }
    // Floating-point rounding can make the chances add up to a hair under 1, leaving a
    // tiny remainder after the last professor. Such a roll belongs in the last segment.
    return odds[odds.length - 1].professor;
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
 * Reads a player's pity: their pulls in a row without a Legendary, and without an Epic or Legendary.
 * @param db - The open game database.
 * @param userId - The id of the player.
 * @returns The player's pity, which is 0 for both until their first pull.
 */
export function pityFor(db: DatabaseSync, userId: string): Pity {
    const row = pityRow(db, userId);
    return { legendary: row.legendary_pity, epic: row.epic_pity };
}

/**
 * Performs one pull for a player: spends PULL_COST tokens and draws a professor using the
 * player's pity. A professor the player does not own yet joins their inventory at
 * level 1 with 1 copy; a professor they already own gains another copy instead. Pity:
 * a Legendary resets the Legendary count, and an Epic or a Legendary resets the Epic count
 * (pulls in a row without either); every other pull adds 1 to each count.
 * All of this is saved in one transaction, so tokens are never spent without the
 * professor being saved.
 * @param db - The open game database.
 * @param userId - The id of the player who is pulling.
 * @param random - Passed to pickProfessor; defaults to Math.random.
 * @returns The player's token balance after paying, their pity after the pull, the
 * professor's inventory item (`item.professor.cage` is the cage they arrive in), and
 * whether they are new to the player (`isNew`). Returns undefined, with nothing
 * changed, if the player has fewer than PULL_COST tokens.
 */
export function pullGacha(db: DatabaseSync, userId: string, random: () => number = Math.random):
    { tokens: number; pity: Pity; item: InventoryItem; isNew: boolean } | undefined {
    const before = pityFor(db, userId);
    // Draw from the whole pool every time (with replacement), so a professor the player
    // already owns can be drawn again. The persistence layer saves that as an extra copy.
    const professor = pickProfessor(before, random);
    const pity = {
        legendary: professor.rarity === "Legendary" ? 0 : before.legendary + 1,
        // Either top rarity restarts the 10-pull guarantee, so the player sees one at least every EPIC_PITY pulls.
        epic: professor.rarity === "Epic" || professor.rarity === "Legendary" ? 0 : before.epic + 1,
    };
    const saved = savePull(db, userId, professor.id, PULL_COST, { legendary_pity: pity.legendary, epic_pity: pity.epic });
    if (!saved) return undefined;
    const { row, tokens } = saved;
    // New professors start with 1 copy, and a duplicate always brings the count to at least 2.
    return { item: { level: row.level, copies: row.copies, obtainedAt: row.obtained_at, professor }, isNew: row.copies === 1, tokens, pity };
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
