import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { openDatabase, userById } from "../BackEnd/database.ts";
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
        { id: "a", name: "A", image: "/a.png", avgRating: 1, department: "Physics", stats: { health: 1, attack: 1, defense: 1, speed: 1 }, copiesToLevelUp: 1 },
        { id: "b", name: "B", image: "/b.png", avgRating: 4, department: "English", stats: { health: 1, attack: 1, defense: 1, speed: 1 }, copiesToLevelUp: 1 },
    ]);
    // Weights 1 and 1/4 give chances of 80% and 20%.
    assert.deepEqual(pool.map((professor) => professor.pullChance), [0.8, 0.2]);
    assert.equal(pickProfessor(pool, () => 0).id, "a");
    assert.equal(pickProfessor(pool, () => 0.79).id, "a");
    assert.equal(pickProfessor(pool, () => 0.8).id, "b");
    assert.equal(pickProfessor(pool, () => 0.999999).id, "b");
});

test("invalid roster entries are rejected", () => {
    const valid: ProfessorEntry = { id: "a", name: "A", image: "/a.png", avgRating: 3, department: "Physics", stats: { health: 1, attack: 1, defense: 1, speed: 1 }, copiesToLevelUp: 3 };
    assert.throws(() => buildPool([]), /empty/);
    assert.throws(() => buildPool([valid, valid]), /duplicate id/);
    assert.throws(() => buildPool([{ ...valid, avgRating: 0 }]), /avgRating/);
    assert.throws(() => buildPool([{ ...valid, avgRating: Number.NaN }]), /avgRating/);
    assert.throws(() => buildPool([{ ...valid, department: "Alchemy" as ProfessorEntry["department"] }]), /department/);
    assert.throws(() => buildPool([{ ...valid, stats: { ...valid.stats, speed: 0 } }]), /stats/);
    assert.throws(() => buildPool([{ ...valid, copiesToLevelUp: 0 }]), /copiesToLevelUp/);
    assert.throws(() => buildPool([{ ...valid, copiesToLevelUp: 1.5 }]), /copiesToLevelUp/);
});

test("pulling spends tokens and adds the professor to the inventory, or changes nothing when unaffordable", () => {
    const db = openDatabase(":memory:");
    const userId = Number(db.prepare("INSERT INTO users (username, password_hash, tokens) VALUES ('Puller', 'scrypt:aa:bb', ?)")
        .run(PULL_COST * 2 + 5).lastInsertRowid);
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
    assert.equal(userById(db, userId)?.tokens, 5);
    assert.deepEqual(owned(), [GACHA_POOL[0].id, GACHA_POOL.at(-1)?.id]);
    assert.deepEqual(inventoryFor(db, userId)[0], first?.item);
    assert.equal(db.isTransaction, false);
    db.close();
});

test("pulling a professor the player already owns adds a copy", () => {
    const db = openDatabase(":memory:");
    const userId = Number(db.prepare("INSERT INTO users (username, password_hash, tokens) VALUES ('Collector', 'scrypt:aa:bb', ?)")
        .run(PULL_COST * 3).lastInsertRowid);
    const pulls = [0, 1, 2].map(() => pullProfessor(db, userId, () => 0));
    assert.deepEqual(pulls.map((pull) => [pull?.isNew, pull?.item.copies, pull?.item.level]), [[true, 1, 1], [false, 2, 1], [false, 3, 1]]);
    assert.equal(pulls[2]?.item.obtainedAt, pulls[0]?.item.obtainedAt);
    assert.deepEqual(inventoryFor(db, userId).map((item) => [item.professor.id, item.copies]), [[GACHA_POOL[0].id, 3]]);
    assert.throws(() => db.prepare("INSERT INTO inventory (user_id, professor_id) VALUES (?, ?)").run(userId, GACHA_POOL[0].id), /UNIQUE constraint failed/);
    db.close();
});

test("levelling up spends copiesToLevelUp copies and always keeps one", () => {
    const db = openDatabase(":memory:");
    const professor = GACHA_POOL[0];
    const needed = professor.copiesToLevelUp;
    const userId = Number(db.prepare("INSERT INTO users (username, password_hash, tokens) VALUES ('Leveler', 'scrypt:aa:bb', ?)")
        .run(PULL_COST * (2 * needed + 1)).lastInsertRowid);

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

test("each player's copies and levels are separate, and professors no longer in the pool are left out", () => {
    const db = openDatabase(":memory:");
    const insert = db.prepare("INSERT INTO users (username, password_hash, tokens) VALUES (?, 'scrypt:aa:bb', ?)");
    const alice = Number(insert.run("Alice", PULL_COST * 2).lastInsertRowid);
    const bob = Number(insert.run("Bob", PULL_COST).lastInsertRowid);
    pullProfessor(db, alice, () => 0);
    pullProfessor(db, alice, () => 0);
    assert.equal(pullProfessor(db, bob, () => 0)?.isNew, true);
    db.prepare("INSERT INTO inventory (user_id, professor_id) VALUES (?, 'retired-professor')").run(bob);
    assert.deepEqual(inventoryFor(db, alice).map((item) => item.copies), [2]);
    assert.deepEqual(inventoryFor(db, bob).map((item) => [item.professor.id, item.copies]), [[GACHA_POOL[0].id, 1]]);
    db.close();
});

test("professors in the older user_professors table move into the inventory, with duplicates counted as copies", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "professor-go-test-"));
    t.after(async () => {
        assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
        await rm(directory, { recursive: true, force: true });
    });
    const databasePath = join(directory, "legacy.sqlite");
    const legacy = openDatabase(databasePath);
    legacy.exec(`
        DROP TABLE inventory;
        CREATE TABLE user_professors (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            professor_id TEXT NOT NULL,
            pulled_at TEXT NOT NULL
        );
        INSERT INTO users (username, password_hash) VALUES ('Veteran', 'scrypt:aa:bb');
        INSERT INTO user_professors (user_id, professor_id, pulled_at) VALUES
            (1, '${GACHA_POOL[1].id}', '2026-10-01T00:00:00.000Z'), (1, '${GACHA_POOL[2].id}', '2026-10-02T00:00:00.000Z'),
            (1, '${GACHA_POOL[1].id}', '2026-10-03T00:00:00.000Z'), (1, '${GACHA_POOL[1].id}', '2026-10-04T00:00:00.000Z');
    `);
    legacy.close();
    for (let opening = 0; opening < 2; opening++) {
        const db = openDatabase(databasePath);
        const inventory = inventoryFor(db, 1);
        const oldTable = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'user_professors'").get();
        db.close();
        assert.equal(oldTable, undefined);
        assert.deepEqual(inventory.map((item) => [item.professor.id, item.copies, item.obtainedAt]), [
            [GACHA_POOL[1].id, 3, "2026-10-01T00:00:00.000Z"],
            [GACHA_POOL[2].id, 1, "2026-10-02T00:00:00.000Z"],
        ]);
    }
});
