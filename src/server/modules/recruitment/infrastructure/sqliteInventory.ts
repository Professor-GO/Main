import type { DatabaseSync } from "node:sqlite";

/** An owned professor as stored in SQLite, without the shared roster details. */
export type InventoryRow = { professor_id: string; level: number; copies: number; obtained_at: string };

/** A player's pulls in a row without a Legendary, and without an Epic or a Legendary, as stored in SQLite. */
export type PityRow = { legendary_pity: number; epic_pity: number };

/**
 * Reads a player's saved professors, oldest first.
 * @param db - The open game database.
 * @param userId - The player's account id.
 * @returns Their inventory rows.
 */
export function inventoryRows(db: DatabaseSync, userId: string): InventoryRow[] {
    return db.prepare("SELECT professor_id, level, copies, obtained_at FROM inventory WHERE user_id = ? ORDER BY id")
        .all(userId) as InventoryRow[];
}

/**
 * Reads a player's gacha pity.
 * @param db - The open game database.
 * @param userId - The player's account id.
 * @returns Their pity row, which is 0 for both counts until their first pull.
 */
export function pityRow(db: DatabaseSync, userId: string): PityRow {
    const row = db.prepare("SELECT legendary_pity, epic_pity FROM gacha_pity WHERE user_id = ?").get(userId) as PityRow | undefined;
    return row ?? { legendary_pity: 0, epic_pity: 0 };
}

/**
 * Spends tokens on a pull, saves the player's new pity, and saves the prize, all in one transaction.
 * @param db - The open game database.
 * @param userId - The player's account id.
 * @param cost - The token cost of one pull.
 * @param pity - The player's pity after this pull.
 * @param savePrize - Saves the prize the gacha system selected and returns what was saved.
 * @returns What savePrize returned and the remaining tokens, or undefined if unaffordable.
 * @throws If saving fails; token spending is rolled back as well.
 */
function spendOnPull<Saved>(db: DatabaseSync, userId: string, cost: number, pity: PityRow, savePrize: () => Saved): { saved: Saved; tokens: number } | undefined {
    db.exec("BEGIN IMMEDIATE");
    try {
        const balance = db.prepare('UPDATE "user" SET tokens = tokens - ? WHERE id = ? AND tokens >= ? RETURNING tokens')
            .get(cost, userId, cost) as { tokens: number } | undefined;
        if (!balance) {
            db.exec("ROLLBACK");
            return undefined;
        }
        db.prepare(`
            INSERT INTO gacha_pity (user_id, legendary_pity, epic_pity) VALUES (?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET legendary_pity = excluded.legendary_pity, epic_pity = excluded.epic_pity
        `).run(userId, pity.legendary_pity, pity.epic_pity);
        const saved = savePrize();
        db.exec("COMMIT");
        return { saved, tokens: balance.tokens };
    } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
    }
}

/**
 * Spends tokens, saves the player's new pity, and adds an inventory copy in one transaction.
 * @param db - The open game database.
 * @param userId - The player's account id.
 * @param professorId - The professor selected by the gacha system.
 * @param cost - The token cost of one pull.
 * @param pity - The player's pity after this pull.
 * @returns The saved row and remaining tokens, or undefined if unaffordable.
 * @throws If saving fails; token spending is rolled back as well.
 */
export function savePull(db: DatabaseSync, userId: string, professorId: string, cost: number, pity: PityRow): { row: InventoryRow; tokens: number } | undefined {
    const pull = spendOnPull(db, userId, cost, pity, () => db.prepare(`
        INSERT INTO inventory (user_id, professor_id) VALUES (?, ?)
        ON CONFLICT (user_id, professor_id) DO UPDATE SET copies = copies + 1
        RETURNING professor_id, level, copies, obtained_at
    `).get(userId, professorId) as InventoryRow);
    return pull && { row: pull.saved, tokens: pull.tokens };
}

/**
 * Spends tokens, saves the player's new pity, and adds one of an item in one transaction.
 * @param db - The open game database.
 * @param userId - The player's account id.
 * @param itemId - The item selected by the gacha system, such as a cage.
 * @param cost - The token cost of one pull.
 * @param pity - The player's pity after this pull.
 * @returns How many of the item the player now has and their remaining tokens, or undefined if unaffordable.
 * @throws If saving fails; token spending is rolled back as well.
 */
export function saveItemPull(db: DatabaseSync, userId: string, itemId: string, cost: number, pity: PityRow): { quantity: number; tokens: number } | undefined {
    const pull = spendOnPull(db, userId, cost, pity, () => db.prepare(`
        INSERT INTO items (user_id, item_id) VALUES (?, ?)
        ON CONFLICT (user_id, item_id) DO UPDATE SET quantity = quantity + 1
        RETURNING quantity
    `).get(userId, itemId) as { quantity: number });
    return pull && { quantity: pull.saved.quantity, tokens: pull.tokens };
}

/**
 * Spends one cage to add a caught wild professor to the inventory: a new professor joins at
 * level 1, and one the player already owns gains a copy. It does not start its own
 * transaction, so call it inside one.
 * @param db - The open game database.
 * @param userId - The player's account id.
 * @param cageId - The cage to spend.
 * @param professorId - The professor that was caught.
 * @returns The saved inventory row and how many of that cage are left, or undefined, with
 * nothing changed, if the player has none of that cage.
 */
export function catchWithCage(db: DatabaseSync, userId: string, cageId: string, professorId: string): { row: InventoryRow; cagesLeft: number } | undefined {
    const cage = db.prepare("UPDATE items SET quantity = quantity - 1 WHERE user_id = ? AND item_id = ? AND quantity > 0 RETURNING quantity")
        .get(userId, cageId) as { quantity: number } | undefined;
    if (!cage) return undefined;
    const row = db.prepare(`
        INSERT INTO inventory (user_id, professor_id) VALUES (?, ?)
        ON CONFLICT (user_id, professor_id) DO UPDATE SET copies = copies + 1
        RETURNING professor_id, level, copies, obtained_at
    `).get(userId, professorId) as InventoryRow;
    return { row, cagesLeft: cage.quantity };
}

/**
 * Reads a player's token balance.
 * @param db - The open game database.
 * @param userId - The player's account id.
 * @returns The balance, or 0 if there is no such player.
 */
export function tokenBalance(db: DatabaseSync, userId: string): number {
    const row = db.prepare('SELECT tokens FROM "user" WHERE id = ?').get(userId) as { tokens: number } | undefined;
    return row?.tokens ?? 0;
}

/**
 * Spends spare copies to raise a professor's saved level, always keeping one copy.
 * @param db - The open game database.
 * @param userId - The player's account id.
 * @param professorId - The professor to level up.
 * @param cost - The number of spare copies required.
 * @returns The row and whether it changed, or undefined if the professor is not owned.
 */
export function spendCopies(db: DatabaseSync, userId: string, professorId: string, cost: number): { row: InventoryRow; levelledUp: boolean } | undefined {
    const levelled = db.prepare(`
        UPDATE inventory SET level = level + 1, copies = copies - ?
        WHERE user_id = ? AND professor_id = ? AND copies > ?
        RETURNING professor_id, level, copies, obtained_at
    `).get(cost, userId, professorId, cost) as InventoryRow | undefined;
    if (levelled) return { row: levelled, levelledUp: true };
    const current = db.prepare("SELECT professor_id, level, copies, obtained_at FROM inventory WHERE user_id = ? AND professor_id = ?")
        .get(userId, professorId) as InventoryRow | undefined;
    return current && { row: current, levelledUp: false };
}
