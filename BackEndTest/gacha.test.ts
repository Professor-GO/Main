import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../BackEnd/Persistence Layer/database.ts";
import { createAuth, hiddenEmail } from "../BackEnd/Persistence Layer/auth.ts";
import { GACHA_POOL, PULL_COST, buildPool, inventoryFor, levelUpProfessor, pickProfessor, pullProfessor, rarityFor } from "../BackEnd/Professor Gacha System/gacha.ts";
import { PROFESSOR_POOL } from "../BackEnd/Professor Gacha System/Professor Pool/professors.ts";
import type { ProfessorEntry } from "../BackEnd/Professor Gacha System/Professor Pool/professors.ts";

test("pull chances are the inverse of each professor's average rating", () => {
    assert.equal(GACHA_POOL.length, PROFESSOR_POOL.length);
    const total = GACHA_POOL.reduce((sum, professor) => sum + professor.pullChance, 0);
    assert.ok(Math.abs(total - 1) < 1e-12);
    // chance × rating is the same for everyone exactly when chance is proportional to 1 / rating.
    for (const professor of GACHA_POOL) {
        assert.ok(Math.abs(professor.pullChance * professor.avgRating - GACHA_POOL[0].pullChance * GACHA_POOL[0].avgRating) < 1e-12);
        assert.equal(professor.rarity, rarityFor(professor.avgRating));
    }
    const best = GACHA_POOL.reduce((a, b) => a.avgRating > b.avgRating ? a : b);
    const worst = GACHA_POOL.reduce((a, b) => a.avgRating < b.avgRating ? a : b);
    assert.ok(best.pullChance < worst.pullChance);
});

test("rarity rises with average rating", () => {
    assert.deepEqual([1, 2.99, 3, 3.99, 4, 4.49, 4.5, 5].map(rarityFor),
        ["Common", "Common", "Rare", "Rare", "Epic", "Epic", "Legendary", "Legendary"]);
});

test("draws follow the cumulative pull chances", () => {
    const pool = buildPool([
        { id: "a", name: "A", image: "/a.png", avgRating: 1, department: "Computer Science", stats: { health: 1, attack: 1, defense: 1, speed: 1 }, copiesToLevelUp: 1 },
        { id: "b", name: "B", image: "/b.png", avgRating: 4, department: "Mathematics", stats: { health: 1, attack: 1, defense: 1, speed: 1 }, copiesToLevelUp: 1 },
    ]);
    // Weights 1 and 1/4 give chances of 80% and 20%.
    assert.deepEqual(pool.map((professor) => professor.pullChance), [0.8, 0.2]);
    assert.equal(pickProfessor(pool, () => 0).id, "a");
    assert.equal(pickProfessor(pool, () => 0.79).id, "a");
    assert.equal(pickProfessor(pool, () => 0.8).id, "b");
    assert.equal(pickProfessor(pool, () => 0.999999).id, "b");
});

test("invalid roster entries are rejected", () => {
    const valid: ProfessorEntry = { id: "a", name: "A", image: "/a.png", avgRating: 3, department: "Computer Science", stats: { health: 1, attack: 1, defense: 1, speed: 1 }, copiesToLevelUp: 3 };
    assert.throws(() => buildPool([]), /empty/);
    assert.throws(() => buildPool([valid, valid]), /duplicate id/);
    assert.throws(() => buildPool([{ ...valid, avgRating: 0 }]), /avgRating/);
    assert.throws(() => buildPool([{ ...valid, avgRating: Number.NaN }]), /avgRating/);
    assert.throws(() => buildPool([{ ...valid, department: "Alchemy" as ProfessorEntry["department"] }]), /department/);
    assert.throws(() => buildPool([{ ...valid, stats: { ...valid.stats, speed: 0 } }]), /stats/);
    assert.throws(() => buildPool([{ ...valid, copiesToLevelUp: 0 }]), /copiesToLevelUp/);
    assert.throws(() => buildPool([{ ...valid, copiesToLevelUp: 1.5 }]), /copiesToLevelUp/);
});

// Settings for createAuth() in tests. The in-memory databases never leave the test.
const TEST_AUTH = { baseURL: "http://127.0.0.1", secret: "test-secret-for-gacha-tests-only-0123456789", production: false };

/**
 * Opens an in-memory database with the game tables and Better Auth's account tables.
 * @returns A promise for the open database. Call close() on it when finished.
 */
async function testDatabase(): Promise<DatabaseSync> {
    const db = openDatabase(":memory:");
    await createAuth(db, TEST_AUTH);
    return db;
}

/**
 * Adds a player straight to Better Auth's user table, without a password.
 * @param db - The test database.
 * @param name - The player's username.
 * @param tokens - The player's token balance.
 * @returns The player's user id.
 */
function addPlayer(db: DatabaseSync, name: string, tokens: number): string {
    const id = `player-${name.toLowerCase()}`;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, username, displayUsername, tokens, isActive)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, 1)`).run(id, name, hiddenEmail(name), now, now, name.toLowerCase(), name, tokens);
    return id;
}

/**
 * Reads a player's token balance.
 * @param db - The test database.
 * @param userId - The player's user id.
 * @returns The balance.
 */
function tokensOf(db: DatabaseSync, userId: string): number {
    return (db.prepare('SELECT tokens FROM "user" WHERE id = ?').get(userId) as { tokens: number }).tokens;
}

test("pulling spends tokens and adds the professor to the inventory, or changes nothing when unaffordable", async () => {
    const db = await testDatabase();
    const userId = addPlayer(db, "Puller", PULL_COST * 2 + 5);
    // Returns the ids of the professors in the test player's inventory, in the order they were first pulled.
    const owned = () => inventoryFor(db, userId).map((item) => item.professor.id);

    const first = pullProfessor(db, userId, () => 0);
    assert.equal(first?.item.professor.id, GACHA_POOL[0].id);
    assert.equal(first?.item.level, 1);
    assert.equal(first?.item.copies, 1);
    assert.equal(first?.isNew, true);
    assert.equal(first?.tokens, PULL_COST + 5);
    const second = pullProfessor(db, userId, () => 0.999999);
    assert.equal(second?.item.professor.id, GACHA_POOL.at(-1)?.id);
    assert.equal(second?.isNew, true);
    assert.equal(second?.tokens, 5);

    assert.equal(pullProfessor(db, userId), undefined);
    assert.equal(tokensOf(db, userId), 5);
    assert.deepEqual(owned(), [GACHA_POOL[0].id, GACHA_POOL.at(-1)?.id]);
    assert.deepEqual(inventoryFor(db, userId)[0], first?.item);
    assert.equal(db.isTransaction, false);
    assert.equal(pullProfessor(db, "no-such-player"), undefined);
    db.close();
});

test("token balances can never go negative", async () => {
    const db = await testDatabase();
    const userId = addPlayer(db, "Saver", 3);
    assert.throws(() => db.prepare('UPDATE "user" SET tokens = -1 WHERE id = ?').run(userId), /tokens cannot be negative/);
    assert.throws(() => addPlayer(db, "Debtor", -5), /tokens cannot be negative/);
    assert.equal(tokensOf(db, userId), 3);
    db.close();
});

test("pulling a professor the player already owns adds a copy", async () => {
    const db = await testDatabase();
    const userId = addPlayer(db, "Collector", PULL_COST * 3);
    const pulls = [0, 1, 2].map(() => pullProfessor(db, userId, () => 0));
    assert.deepEqual(pulls.map((pull) => [pull?.isNew, pull?.item.copies, pull?.item.level]), [[true, 1, 1], [false, 2, 1], [false, 3, 1]]);
    assert.equal(pulls[2]?.item.obtainedAt, pulls[0]?.item.obtainedAt);
    assert.deepEqual(inventoryFor(db, userId).map((item) => [item.professor.id, item.copies]), [[GACHA_POOL[0].id, 3]]);
    assert.throws(() => db.prepare("INSERT INTO inventory (user_id, professor_id) VALUES (?, ?)").run(userId, GACHA_POOL[0].id), /UNIQUE constraint failed/);
    db.close();
});

test("levelling up spends copiesToLevelUp copies and always keeps one", async () => {
    const db = await testDatabase();
    const professor = GACHA_POOL[0];
    const needed = professor.copiesToLevelUp;
    const userId = addPlayer(db, "Leveler", PULL_COST * (2 * needed + 1));

    assert.equal(levelUpProfessor(db, userId, professor.id), undefined);
    assert.equal(levelUpProfessor(db, userId, "no-such-professor"), undefined);
    for (let pull = 0; pull < needed; pull++) pullProfessor(db, userId, () => 0);
    // One copy short: the professor itself plus copiesToLevelUp spare copies are needed.
    const short = levelUpProfessor(db, userId, professor.id);
    assert.deepEqual([short?.levelledUp, short?.item.level, short?.item.copies], [false, 1, needed]);

    pullProfessor(db, userId, () => 0);
    const levelled = levelUpProfessor(db, userId, professor.id);
    assert.deepEqual([levelled?.levelledUp, levelled?.item.level, levelled?.item.copies], [true, 2, 1]);
    assert.equal(levelUpProfessor(db, userId, professor.id)?.levelledUp, false);

    for (let pull = 0; pull < needed; pull++) pullProfessor(db, userId, () => 0);
    assert.equal(levelUpProfessor(db, userId, professor.id)?.item.level, 3);
    assert.deepEqual(inventoryFor(db, userId).map((item) => [item.level, item.copies]), [[3, 1]]);
    assert.throws(() => db.prepare("UPDATE inventory SET copies = 0 WHERE user_id = ?").run(userId), /CHECK constraint failed/);
    db.close();
});

test("each player's copies and levels are separate, and professors no longer in the pool are left out", async () => {
    const db = await testDatabase();
    const alice = addPlayer(db, "Alice", PULL_COST * 2);
    const bob = addPlayer(db, "Bob", PULL_COST);
    pullProfessor(db, alice, () => 0);
    pullProfessor(db, alice, () => 0);
    assert.equal(pullProfessor(db, bob, () => 0)?.isNew, true);
    db.prepare("INSERT INTO inventory (user_id, professor_id) VALUES (?, 'retired-professor')").run(bob);
    assert.deepEqual(inventoryFor(db, alice).map((item) => item.copies), [2]);
    assert.deepEqual(inventoryFor(db, bob).map((item) => [item.professor.id, item.copies]), [[GACHA_POOL[0].id, 1]]);
    // Removing an account removes its inventory too.
    db.prepare('DELETE FROM "user" WHERE id = ?').run(bob);
    assert.deepEqual(inventoryFor(db, bob), []);
    db.close();
});

test("an inventory from before Better Auth is set aside, and the old accounts are left untouched", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "professor-go-test-"));
    t.after(async () => {
        assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
        await rm(directory, { recursive: true, force: true });
    });
    const databasePath = join(directory, "legacy.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
        CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL, tokens INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
        CREATE TABLE inventory (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            professor_id TEXT NOT NULL,
            level INTEGER NOT NULL DEFAULT 1,
            copies INTEGER NOT NULL DEFAULT 1,
            obtained_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            UNIQUE (user_id, professor_id)
        );
        INSERT INTO users (username, password_hash, tokens) VALUES ('Veteran', 'scrypt:aa:bb', 30);
        INSERT INTO inventory (user_id, professor_id, copies) VALUES (1, '${GACHA_POOL[1].id}', 3);
    `);
    legacy.close();
    for (let opening = 0; opening < 2; opening++) {
        const db = openDatabase(databasePath);
        await createAuth(db, TEST_AUTH);
        assert.deepEqual(db.prepare("SELECT professor_id, copies FROM inventory_legacy").all().map((row) => ({ ...row })), [{ professor_id: GACHA_POOL[1].id, copies: 3 }]);
        assert.deepEqual(db.prepare("SELECT username, tokens FROM users").all().map((row) => ({ ...row })), [{ username: "Veteran", tokens: 30 }]);
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory").get()?.n, 0);
        const userColumn = (db.prepare("PRAGMA table_info(inventory)").all() as { name: string; type: string }[]).find((column) => column.name === "user_id");
        assert.equal(userColumn?.type, "TEXT");
        db.close();
    }
});
