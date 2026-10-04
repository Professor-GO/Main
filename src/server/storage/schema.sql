-- Professor-Go: game database template (SQLite / Node.js 24).
-- This is the schema loaded by database.ts in this folder on startup.
-- Safe to run again: existing tables and data are preserved.
-- Changes to existing columns require an explicit migration; IF NOT EXISTS
-- only creates missing objects and does not update their definitions.
--
-- Player accounts are not defined here: Better Auth creates and upgrades its own
-- tables ("user", "session", "account", "verification") in auth.ts in this folder.
-- Each player's token balance is the "tokens" column of the "user" table.

-- SQLite requires foreign-key enforcement on each database connection.
PRAGMA foreign_keys = ON;

-- Each player's inventory: one row per professor they have recruited.
-- Pulling a professor again adds a copy to the same row. Players spend spare copies to level up.
-- An inventory from before Better Auth is renamed to inventory_legacy in database.ts.
CREATE TABLE IF NOT EXISTS inventory (
    -- Row ID; also keeps the inventory in the order professors were first recruited.
    id INTEGER PRIMARY KEY,

    -- The player's Better Auth user id. Removing an account also removes its inventory.
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

    -- The professor's id from BackEnd/Professor Gacha System/Professor Pool/professors.ts.
    professor_id TEXT NOT NULL,

    -- The professor's current level. It starts at 1 and rises when the player spends copies.
    level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),

    -- Copies of this professor the player owns, including the one in use. Each duplicate pull adds 1;
    -- levelling up spends the professor's copiesToLevelUp. The player always keeps at least one.
    copies INTEGER NOT NULL DEFAULT 1 CHECK (copies >= 1),

    -- UTC timestamp, automatically recorded when the professor is first recruited.
    obtained_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    -- One row per player and professor; duplicates are counted in copies instead.
    -- This also lets SQLite look up a player's inventory quickly.
    UNIQUE (user_id, professor_id)
);
