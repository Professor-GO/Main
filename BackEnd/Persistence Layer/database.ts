import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeQuestions } from "./questions.ts";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
export const DEFAULT_DATABASE_PATH = fileURLToPath(new URL("./data/game.sqlite", import.meta.url));

/**
 * Opens the SQLite database, creating the file and its folder if needed, and makes
 * sure the game's tables from schema.sql exist. Account tables are created separately
 * by createAuth() in auth.ts.
 * @param filename - Path to the database file, or ":memory:" for a temporary in-memory database.
 * @returns The open database connection. Call close() on it when finished.
 */
export function openDatabase(filename: string): DatabaseSync {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
    const db = new DatabaseSync(filename);
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
    `);
    setAsideOldInventory(db);
    db.exec(schema);
    initializeQuestions(db);
    return db;
}

/**
 * Accounts moved to Better Auth, and old accounts were not carried over. An inventory
 * table from before then belongs to the old "users" table, so it is renamed to
 * inventory_legacy (keeping its rows) and a new, empty inventory is created by schema.sql.
 * The old users and sessions tables are left as they are. Safe to run every time.
 * @param db - The open database.
 */
function setAsideOldInventory(db: DatabaseSync): void {
    const references = db.prepare("SELECT \"table\" FROM pragma_foreign_key_list('inventory')").all() as { table: string }[];
    if (references.some((reference) => reference.table === "users")) {
        db.exec("ALTER TABLE inventory RENAME TO inventory_legacy");
    }
}
