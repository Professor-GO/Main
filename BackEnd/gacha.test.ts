import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, userById } from "./database.ts";
import { GACHA_POOL, PULL_COST, buildPool, pickProfessor, pullProfessor, rarityFor } from "./Professor Gacha System/gacha.ts";
import { PROFESSOR_POOL } from "./Professor Gacha System/Professor Pool/professors.ts";
import type { ProfessorEntry } from "./Professor Gacha System/Professor Pool/professors.ts";

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
        { id: "a", name: "A", image: "/a.png", avgRating: 1, department: "Physics", stats: { health: 1, attack: 1, defense: 1, speed: 1 } },
        { id: "b", name: "B", image: "/b.png", avgRating: 4, department: "English", stats: { health: 1, attack: 1, defense: 1, speed: 1 } },
    ]);
    // Weights 1 and 1/4 give chances of 80% and 20%.
    assert.deepEqual(pool.map((professor) => professor.pullChance), [0.8, 0.2]);
    assert.equal(pickProfessor(pool, () => 0).id, "a");
    assert.equal(pickProfessor(pool, () => 0.79).id, "a");
    assert.equal(pickProfessor(pool, () => 0.8).id, "b");
    assert.equal(pickProfessor(pool, () => 0.999999).id, "b");
});

test("invalid roster entries are rejected", () => {
    const valid: ProfessorEntry = { id: "a", name: "A", image: "/a.png", avgRating: 3, department: "Physics", stats: { health: 1, attack: 1, defense: 1, speed: 1 } };
    assert.throws(() => buildPool([]), /empty/);
    assert.throws(() => buildPool([valid, valid]), /duplicate id/);
    assert.throws(() => buildPool([{ ...valid, avgRating: 0 }]), /avgRating/);
    assert.throws(() => buildPool([{ ...valid, avgRating: Number.NaN }]), /avgRating/);
    assert.throws(() => buildPool([{ ...valid, department: "Alchemy" as ProfessorEntry["department"] }]), /department/);
    assert.throws(() => buildPool([{ ...valid, stats: { ...valid.stats, speed: 0 } }]), /stats/);
});

test("pulling spends tokens and records the professor, or changes nothing when unaffordable", () => {
    const db = openDatabase(":memory:");
    const userId = Number(db.prepare("INSERT INTO users (username, password_hash, tokens) VALUES ('Puller', 'scrypt:aa:bb', ?)")
        .run(PULL_COST * 2 + 5).lastInsertRowid);
    // Returns the ids of the professors the test player owns, in the order they were pulled.
    const owned = () => db.prepare("SELECT professor_id FROM user_professors WHERE user_id = ? ORDER BY id").all(userId).map((row) => row.professor_id);

    const first = pullProfessor(db, userId, () => 0);
    assert.equal(first?.professor.id, GACHA_POOL[0].id);
    assert.equal(first?.tokens, PULL_COST + 5);
    const second = pullProfessor(db, userId, () => 0.999999);
    assert.equal(second?.professor.id, GACHA_POOL.at(-1)?.id);
    assert.equal(second?.tokens, 5);

    assert.equal(pullProfessor(db, userId), undefined);
    assert.equal(userById(db, userId)?.tokens, 5);
    assert.deepEqual(owned(), [GACHA_POOL[0].id, GACHA_POOL.at(-1)?.id]);
    assert.equal(db.isTransaction, false);
    db.close();
});
