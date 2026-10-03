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

    -- Gacha token balance. New accounts start with none; it can never go negative.
    -- Databases created before this column existed are upgraded in database.ts.
    tokens INTEGER NOT NULL DEFAULT 0 CHECK (tokens >= 0)
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
