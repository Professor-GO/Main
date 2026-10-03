-- Professor-Go: user account database template (SQLite / Node.js 24).
-- This is the schema loaded by BackEnd/database.ts on startup.
-- Safe to run again: existing tables and account data are preserved.
-- Changes to existing columns require an explicit migration; IF NOT EXISTS
-- only creates missing objects and does not update their definitions.

-- SQLite requires foreign-key enforcement on each database connection.
PRAGMA foreign_keys = ON;

-- One row per player account.
CREATE TABLE IF NOT EXISTS users (
    -- SQLite automatically assigns an ID when it is omitted on insert.
    id INTEGER PRIMARY KEY,

    -- Unique without regard to ASCII letter case; original casing is preserved.
    -- The API enforces 3-20 letters, numbers, or underscores.
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,

    -- Store only the hash returned by hashPassword() in database.ts.
    -- Format: scrypt:<random salt in hex>:<derived key in hex>.
    -- Never put a plaintext password in this column.
    password_hash TEXT NOT NULL,

    -- UTC timestamp, automatically recorded when the account is created.
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    -- 1 = active, 0 = inactive. New accounts are active by default.
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),

    -- Gacha token balance; it can never go negative. New accounts start with 50
    -- (STARTING_TOKENS in database.ts, which signup sets explicitly).
    -- Databases created before this column existed are upgraded in database.ts,
    -- and accounts created before then start with 0.
    tokens INTEGER NOT NULL DEFAULT 50 CHECK (tokens >= 0)
);

-- One account can have multiple login sessions (for example, on two devices).
CREATE TABLE IF NOT EXISTS sessions (
    -- SHA-256 hash of the random session token. The raw token stays in the cookie.
    token_hash TEXT PRIMARY KEY,

    -- Removing an account also removes all its sessions.
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Expiration as Unix time in milliseconds, matching JavaScript Date.now().
    expires_at INTEGER NOT NULL
);

-- Supports finding or revoking all sessions belonging to an account.
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);

-- Each player's inventory: one row per professor they have recruited.
-- Pulling a professor again adds a copy to the same row. Players spend spare copies to level up.
-- Databases that still have the older user_professors table are upgraded in database.ts.
CREATE TABLE IF NOT EXISTS inventory (
    -- Row ID; also keeps the inventory in the order professors were first recruited.
    id INTEGER PRIMARY KEY,

    -- Removing an account also removes its inventory.
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

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
