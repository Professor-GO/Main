import type { DatabaseSync } from "node:sqlite";

/** An owned professor as stored in SQLite, without the shared roster details. */
export type InventoryRow = { professor_id: string; level: number; copies: number; obtained_at: string };

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
 * Spends tokens and adds an inventory copy in one transaction.
 * @param db - The open game database.
 * @param userId - The player's account id.
 * @param professorId - The professor selected by the gacha system.
 * @param cost - The token cost of one pull.
 * @returns The saved row and remaining tokens, or undefined if unaffordable.
 * @throws If saving fails; token spending is rolled back as well.
 */
export function savePull(db: DatabaseSync, userId: string, professorId: string, cost: number): { row: InventoryRow; tokens: number } | undefined {
    db.exec("BEGIN IMMEDIATE");
    try {
        const balance = db.prepare('UPDATE "user" SET tokens = tokens - ? WHERE id = ? AND tokens >= ? RETURNING tokens')
            .get(cost, userId, cost) as { tokens: number } | undefined;
        if (!balance) {
            db.exec("ROLLBACK");
            return undefined;
        }
        const row = db.prepare(`
            INSERT INTO inventory (user_id, professor_id) VALUES (?, ?)
            ON CONFLICT (user_id, professor_id) DO UPDATE SET copies = copies + 1
            RETURNING professor_id, level, copies, obtained_at
        `).get(userId, professorId) as InventoryRow;
        db.exec("COMMIT");
        return { row, tokens: balance.tokens };
    } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
    }
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
