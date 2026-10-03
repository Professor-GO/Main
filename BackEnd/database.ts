import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify<string, string, number, Buffer>(scrypt);
const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
export const SESSION_SECONDS = 60 * 60 * 24 * 7;

// SQLite returns untyped rows. Keep the account shape at the query boundary.
export type UserRow = {
    id: number;
    username: string;
    password_hash: string;
    created_at: string;
    is_active: 0 | 1;
    tokens: number;
};

export type PublicUser = {
    id: number;
    username: string;
    createdAt: string;
    isActive: boolean;
    tokens: number;
};

/**
 * Opens the SQLite database, creating the file and its folder if needed, and makes
 * sure all tables from schema.sql exist and are up to date.
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
    db.exec(schema);
    migrate(db);
    return db;
}

/**
 * Upgrades databases created by older versions of the app. CREATE TABLE IF NOT EXISTS
 * leaves older tables unchanged, so columns added later are added here.
 * Safe to run every time the database opens.
 * @param db - The open database to upgrade.
 */
function migrate(db: DatabaseSync): void {
    const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "tokens")) {
        db.exec("ALTER TABLE users ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0 CHECK (tokens >= 0)");
    }
}

/**
 * Turns a plaintext password into a salted scrypt hash that is safe to store.
 * @param password - The plaintext password the player typed.
 * @returns A promise for the hash, formatted "scrypt:<salt hex>:<key hex>".
 */
export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const key = await deriveKey(password, salt, 64);
    return `scrypt:${salt}:${key.toString("hex")}`;
}

/**
 * Checks whether a plaintext password matches a stored hash.
 * Uses a constant-time comparison so response timing does not leak the hash.
 * @param password - The plaintext password the player typed.
 * @param storedHash - The hash saved by hashPassword().
 * @returns A promise for true if the password matches, otherwise false
 * (including when the stored hash is malformed).
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [algorithm, salt, encodedKey] = storedHash.split(":");
    if (algorithm !== "scrypt" || !salt || !encodedKey) return false;
    const expected = Buffer.from(encodedKey, "hex");
    const actual = await deriveKey(password, salt, 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Converts a database account row into the shape sent to the website, leaving out
 * private fields such as the password hash.
 * @param user - The account row from the users table.
 * @returns The account's id, username, createdAt, isActive, and tokens.
 */
export function publicUser(user: UserRow): PublicUser {
    return { id: user.id, username: user.username, createdAt: user.created_at, isActive: Boolean(user.is_active), tokens: user.tokens };
}

/**
 * Hashes a session token with SHA-256. Only this hash is stored, so a copy of the
 * database cannot be used to log in as anyone.
 * @param token - The raw session token from the player's cookie.
 * @returns The hash as a 64-character hex string.
 */
export function tokenHash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

/**
 * Starts a new login session for a player that lasts SESSION_SECONDS, and clears
 * out any expired sessions.
 * @param db - The open game database.
 * @param userId - The id of the player who is logging in.
 * @returns The raw session token to put in the player's cookie.
 */
export function createSession(db: DatabaseSync, userId: number): string {
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
        .run(tokenHash(token), userId, Date.now() + SESSION_SECONDS * 1000);
    return token;
}

/**
 * Looks up an account by its id.
 * @param db - The open game database.
 * @param id - The account id.
 * @returns The account row, or undefined if no account has that id.
 */
export function userById(db: DatabaseSync, id: number | bigint): UserRow | undefined {
    return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

/**
 * Looks up an account by username, ignoring letter case.
 * @param db - The open game database.
 * @param username - The username to find.
 * @returns The account row, or undefined if no account has that username.
 */
export function userByUsername(db: DatabaseSync, username: string): UserRow | undefined {
    return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
}

/**
 * Finds the player who owns a session token.
 * @param db - The open game database.
 * @param token - The raw session token from the cookie, or undefined if there is none.
 * @returns The account row, or undefined if the token is missing, unknown, or
 * expired, or the account is inactive.
 */
export function sessionUser(db: DatabaseSync, token: string | undefined): UserRow | undefined {
    if (!token) return undefined;
    return db.prepare(`
        SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.is_active = 1
    `).get(tokenHash(token), Date.now()) as UserRow | undefined;
}
