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

// CREATE TABLE IF NOT EXISTS leaves older tables unchanged, so add newer columns here.
function migrate(db: DatabaseSync): void {
    const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "tokens")) {
        db.exec("ALTER TABLE users ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0 CHECK (tokens >= 0)");
    }
}

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const key = await deriveKey(password, salt, 64);
    return `scrypt:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [algorithm, salt, encodedKey] = storedHash.split(":");
    if (algorithm !== "scrypt" || !salt || !encodedKey) return false;
    const expected = Buffer.from(encodedKey, "hex");
    const actual = await deriveKey(password, salt, 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function publicUser(user: UserRow): PublicUser {
    return { id: user.id, username: user.username, createdAt: user.created_at, isActive: Boolean(user.is_active), tokens: user.tokens };
}

export function tokenHash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export function createSession(db: DatabaseSync, userId: number): string {
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
        .run(tokenHash(token), userId, Date.now() + SESSION_SECONDS * 1000);
    return token;
}

export function userById(db: DatabaseSync, id: number | bigint): UserRow | undefined {
    return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function userByUsername(db: DatabaseSync, username: string): UserRow | undefined {
    return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
}

export function sessionUser(db: DatabaseSync, token: string | undefined): UserRow | undefined {
    if (!token) return undefined;
    return db.prepare(`
        SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.is_active = 1
    `).get(tokenHash(token), Date.now()) as UserRow | undefined;
}
