import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(scrypt);
export const SESSION_SECONDS = 60 * 60 * 24 * 7;

export function openDatabase(filename) {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
    const db = new DatabaseSync(filename);
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL COLLATE NOCASE UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
    `);
    return db;
}

export async function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    const key = await deriveKey(password, salt, 64);
    return `scrypt:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password, storedHash) {
    const [algorithm, salt, encodedKey] = storedHash.split(":");
    if (algorithm !== "scrypt" || !salt || !encodedKey) return false;
    const expected = Buffer.from(encodedKey, "hex");
    const actual = await deriveKey(password, salt, 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function publicUser(user) {
    return { id: user.id, username: user.username, createdAt: user.created_at, isActive: Boolean(user.is_active) };
}

export function tokenHash(token) {
    return createHash("sha256").update(token).digest("hex");
}

export function createSession(db, userId) {
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
        .run(tokenHash(token), userId, Date.now() + SESSION_SECONDS * 1000);
    return token;
}

export function sessionUser(db, token) {
    if (!token) return undefined;
    return db.prepare(`
        SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.is_active = 1
    `).get(tokenHash(token), Date.now());
}
