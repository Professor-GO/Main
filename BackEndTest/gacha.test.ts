import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase, userById } from "../BackEnd/database.ts";
import {
    EPIC_CHANCE, GACHA_CAGES, GACHA_POOL, LEGENDARY_CHANCE, PULL_COST,
    buildPool, cagesFor, inventoryFor, legendaryChance, levelUpProfessor, pickPrize, pityFor, pullGacha, pullOdds, rarityFor,
} from "../BackEnd/Professor Gacha System/gacha.ts";
import type { Prize, Rarity } from "../BackEnd/Professor Gacha System/gacha.ts";
import { PROFESSOR_POOL } from "../BackEnd/Professor Gacha System/Professor Pool/professors.ts";
import type { ProfessorEntry } from "../BackEnd/Professor Gacha System/Professor Pool/professors.ts";

// A roll of 0 always draws this professor: the first Legendary in the pool.
const FIRST_LEGENDARY = GACHA_POOL.filter((professor) => professor.rarity === "Legendary")[0];

/**
 * Checks that two chances are equal, allowing for floating-point rounding.
 * @param actual - The chance that was calculated.
 * @param expected - The chance it should be.
 */
function assertClose(actual: number, expected: number): void {
    assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} is not close to ${expected}`);
}

/**
 * Pulls with a roll of 0, which always draws FIRST_LEGENDARY.
 * @param db - The open test database.
 * @param userId - The id of the player who is pulling.
 * @returns The pull's result, which is always a professor.
 */
function pullLegendary(db: DatabaseSync, userId: number) {
    const pull = pullGacha(db, userId, () => 0);
    assert.ok(pull?.kind === "professor");
    return pull;
}

/**
 * Builds a roster entry for tests that only care about the professor's id and rating.
 * @param id - The professor's id.
 * @param avgRating - The professor's average rating, which decides their rarity.
 * @returns The roster entry.
 */
function entry(id: string, avgRating: number): ProfessorEntry {
    return { id, name: id, image: `/${id}.png`, avgRating, department: "Mathematics", stats: { health: 1, attack: 1, defense: 1, speed: 1 }, copiesToLevelUp: 1 };
}

test("base pull chances cover Legendary and Epic professors and the cages, and add up to 1", () => {
    assert.equal(GACHA_POOL.length, PROFESSOR_POOL.length);
    // Adds up the base pull chances of every professor of one rarity.
    const chanceOf = (rarity: Rarity) => GACHA_POOL.filter((professor) => professor.rarity === rarity)
        .reduce((sum, professor) => sum + professor.pullChance, 0);
    assertClose(chanceOf("Legendary"), LEGENDARY_CHANCE);
    assertClose(chanceOf("Epic"), EPIC_CHANCE);
    assert.equal(chanceOf("Rare"), 0);
    assert.equal(chanceOf("Common"), 0);
    for (const professor of GACHA_POOL) assert.equal(professor.rarity, rarityFor(professor.avgRating));

    // Golden, iron, and bronze cages share the rest in a 1 : 5 : 10 ratio.
    const [golden, iron, bronze] = GACHA_CAGES;
    assert.deepEqual(GACHA_CAGES.map((cage) => cage.id), ["golden-cage", "iron-cage", "bronze-cage"]);
    assertClose(iron.pullChance, 5 * golden.pullChance);
    assertClose(bronze.pullChance, 10 * golden.pullChance);
    assertClose(golden.pullChance + iron.pullChance + bronze.pullChance, 1 - LEGENDARY_CHANCE - EPIC_CHANCE);
});

test("rarity rises with average rating", () => {
    assert.deepEqual([1, 2.99, 3, 3.99, 4, 4.49, 4.5, 5].map(rarityFor),
        ["Common", "Common", "Rare", "Rare", "Epic", "Epic", "Legendary", "Legendary"]);
});

test("the Legendary chance stays flat for 50 pulls, then rises in a straight line to a guarantee on pull 80", () => {
    // legendaryChance takes the pulls already made without a Legendary, so pull 50 is legendaryChance(49).
    assert.equal(legendaryChance(0), 0.0008);
    assert.equal(legendaryChance(49), 0.0008);
    // Pull 65 is halfway between pull 50 (0.08%) and pull 80 (100%).
    assertClose(legendaryChance(64), 0.5004);
    assert.equal(legendaryChance(79), 1);
    assert.equal(legendaryChance(200), 1);
    for (let pullsWithout = 49; pullsWithout < 79; pullsWithout++) {
        assert.ok(legendaryChance(pullsWithout) < legendaryChance(pullsWithout + 1));
    }
});

test("draws follow the pull odds, which pity changes", () => {
    // Two Legendary professors, one Epic, and one Rare who cannot be pulled.
    const pool = buildPool([entry("a", 5), entry("b", 4.6), entry("c", 4), entry("d", 3)]);
    // Returns the id of the professor or cage a prize holds.
    const idOf = (prize: Prize) => prize.kind === "professor" ? prize.professor.id : prize.cage.id;
    // Draws from the test pool with a fixed roll and returns the id of the prize.
    const draw = (legendary: number, epic: number, roll: number) => idOf(pickPrize({ legendary, epic }, () => roll, pool));

    const odds = pullOdds({ legendary: 0, epic: 0 }, pool);
    assert.deepEqual(odds.map(idOf), ["a", "b", "c", "golden-cage", "iron-cage", "bronze-cage"]);
    [0.0004, 0.0004, 0.05, 0.9492 / 16, 0.9492 * 5 / 16, 0.9492 * 10 / 16].forEach((chance, index) => assertClose(odds[index].chance, chance));
    assertClose(odds.reduce((sum, prize) => sum + prize.chance, 0), 1);
    assert.deepEqual([0, 0.0005, 0.03, 0.06, 0.12, 0.5, 0.999999].map((roll) => draw(0, 0, roll)),
        ["a", "b", "c", "golden-cage", "iron-cage", "bronze-cage", "bronze-cage"]);

    // The 10th pull without an Epic is an Epic unless it is a Legendary, so no cage can be drawn.
    assert.equal(draw(0, 8, 0.999999), "bronze-cage");
    assert.equal(draw(0, 9, 0.999999), "c");
    assert.equal(draw(0, 9, 0), "a");
    assert.deepEqual(pullOdds({ legendary: 0, epic: 9 }, pool).slice(3).map((prize) => prize.chance), [0, 0, 0]);
    // The 80th pull without a Legendary is always a Legendary, even when an Epic is also due.
    assert.equal(draw(78, 0, 0.999999), "c");
    assert.equal(draw(79, 0, 0.999999), "b");
    assert.equal(draw(79, 9, 0.999999), "b");
});

test("invalid roster entries are rejected", () => {
    const valid: ProfessorEntry = { id: "a", name: "A", image: "/a.png", avgRating: 3, department: "Mathematics", stats: { health: 1, attack: 1, defense: 1, speed: 1 }, copiesToLevelUp: 3 };
    assert.throws(() => buildPool([]), /empty/);
    assert.throws(() => buildPool([valid, valid]), /duplicate id/);
    assert.throws(() => buildPool([{ ...valid, avgRating: 0 }]), /avgRating/);
    assert.throws(() => buildPool([{ ...valid, avgRating: Number.NaN }]), /avgRating/);
    assert.throws(() => buildPool([{ ...valid, department: "Alchemy" as ProfessorEntry["department"] }]), /department/);
    assert.throws(() => buildPool([{ ...valid, stats: { ...valid.stats, speed: 0 } }]), /stats/);
    assert.throws(() => buildPool([{ ...valid, copiesToLevelUp: 0 }]), /copiesToLevelUp/);
    assert.throws(() => buildPool([{ ...valid, copiesToLevelUp: 1.5 }]), /copiesToLevelUp/);
    assert.throws(() => buildPool([valid, entry("epic", 4)]), /Legendary/);
    assert.throws(() => buildPool([valid, entry("legendary", 5)]), /Epic/);
});

test("pulling spends tokens and saves the professor or cage, or changes nothing when unaffordable", () => {
    const db = openDatabase(":memory:");
    const userId = Number(db.prepare("INSERT INTO users (username, password_hash, tokens) VALUES ('Puller', 'scrypt:aa:bb', ?)")
        .run(PULL_COST * 2 + 5).lastInsertRowid);
    // Returns the ids of the professors in the test player's inventory, in the order they were first pulled.
    const owned = () => inventoryFor(db, userId).map((item) => item.professor.id);
    assert.deepEqual(pityFor(db, userId), { legendary: 0, epic: 0 });

    const first = pullLegendary(db, userId);
    assert.equal(first.item.professor.id, FIRST_LEGENDARY.id);
    assert.equal(first.item.level, 1);
    assert.equal(first.item.copies, 1);
    assert.equal(first.isNew, true);
    assert.equal(first.tokens, PULL_COST + 5);
    assert.deepEqual(first.pity, { legendary: 0, epic: 1 });
    const second = pullGacha(db, userId, () => 0.999999);
    assert.ok(second?.kind === "cage");
    assert.equal(second.cage.id, "bronze-cage");
    assert.equal(second.quantity, 1);
    assert.equal(second.tokens, 5);
    assert.deepEqual(second.pity, { legendary: 1, epic: 2 });

    assert.equal(pullGacha(db, userId), undefined);
    assert.equal(userById(db, userId)?.tokens, 5);
    assert.deepEqual(owned(), [FIRST_LEGENDARY.id]);
    assert.deepEqual(cagesFor(db, userId), [{ cage: GACHA_CAGES[2], quantity: 1 }]);
    assert.deepEqual(pityFor(db, userId), { legendary: 1, epic: 2 });
    assert.deepEqual(inventoryFor(db, userId)[0], first.item);
    assert.equal(db.isTransaction, false);
    db.close();
});

test("pity is saved between pulls and guarantees an Epic every 10 pulls and a Legendary by pull 80", () => {
    const db = openDatabase(":memory:");
    const userId = Number(db.prepare("INSERT INTO users (username, password_hash, tokens) VALUES ('Unlucky', 'scrypt:aa:bb', ?)")
        .run(PULL_COST * 80).lastInsertRowid);
    // The highest roll always draws the last prize that is still possible: a bronze cage, or a professor once pity rules cages out.
    const prizes = Array.from({ length: 80 }, () => {
        const pull = pullGacha(db, userId, () => 0.999999);
        return pull?.kind === "professor" ? pull.item.professor.rarity : pull?.cage.id;
    });
    // Returns the numbers of the pulls, counting from 1, that drew the given prize.
    const pullsOf = (prize: string) => prizes.flatMap((drawn, index) => drawn === prize ? [index + 1] : []);
    // Pull 79 is an Epic too: by then the Legendary chance is over 95%, leaving no room for cages.
    assert.deepEqual(pullsOf("Epic"), [10, 20, 30, 40, 50, 60, 70, 79]);
    assert.deepEqual(pullsOf("Legendary"), [80]);
    assert.equal(pullsOf("bronze-cage").length, 71);
    assert.deepEqual(cagesFor(db, userId), [{ cage: GACHA_CAGES[2], quantity: 71 }]);
    assert.deepEqual(pityFor(db, userId), { legendary: 0, epic: 1 });
    assert.equal(userById(db, userId)?.tokens, 0);
    db.close();
});

test("pulling a professor the player already owns adds a copy", () => {
    const db = openDatabase(":memory:");
    const userId = Number(db.prepare("INSERT INTO users (username, password_hash, tokens) VALUES ('Collector', 'scrypt:aa:bb', ?)")
        .run(PULL_COST * 3).lastInsertRowid);
    const pulls = [0, 1, 2].map(() => pullLegendary(db, userId));
    assert.deepEqual(pulls.map((pull) => [pull.isNew, pull.item.copies, pull.item.level]), [[true, 1, 1], [false, 2, 1], [false, 3, 1]]);
    assert.equal(pulls[2].item.obtainedAt, pulls[0].item.obtainedAt);
    assert.deepEqual(inventoryFor(db, userId).map((item) => [item.professor.id, item.copies]), [[FIRST_LEGENDARY.id, 3]]);
    assert.throws(() => db.prepare("INSERT INTO inventory (user_id, professor_id) VALUES (?, ?)").run(userId, FIRST_LEGENDARY.id), /UNIQUE constraint failed/);
    db.close();
});

test("levelling up spends copiesToLevelUp copies and always keeps one", () => {
    const db = openDatabase(":memory:");
    const professor = FIRST_LEGENDARY;
    const needed = professor.copiesToLevelUp;
    const userId = Number(db.prepare("INSERT INTO users (username, password_hash, tokens) VALUES ('Leveler', 'scrypt:aa:bb', ?)")
        .run(PULL_COST * (2 * needed + 1)).lastInsertRowid);

    assert.equal(levelUpProfessor(db, userId, professor.id), undefined);
    assert.equal(levelUpProfessor(db, userId, "no-such-professor"), undefined);
    for (let pull = 0; pull < needed; pull++) pullLegendary(db, userId);
    // One copy short: the professor itself plus copiesToLevelUp spare copies are needed.
    const short = levelUpProfessor(db, userId, professor.id);
    assert.deepEqual([short?.levelledUp, short?.item.level, short?.item.copies], [false, 1, needed]);

    pullLegendary(db, userId);
    const levelled = levelUpProfessor(db, userId, professor.id);
    assert.deepEqual([levelled?.levelledUp, levelled?.item.level, levelled?.item.copies], [true, 2, 1]);
    assert.equal(levelUpProfessor(db, userId, professor.id)?.levelledUp, false);

    for (let pull = 0; pull < needed; pull++) pullLegendary(db, userId);
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
    pullLegendary(db, alice);
    pullLegendary(db, alice);
    assert.equal(pullLegendary(db, bob).isNew, true);
    db.prepare("INSERT INTO inventory (user_id, professor_id) VALUES (?, 'retired-professor')").run(bob);
    assert.deepEqual(inventoryFor(db, alice).map((item) => item.copies), [2]);
    assert.deepEqual(inventoryFor(db, bob).map((item) => [item.professor.id, item.copies]), [[FIRST_LEGENDARY.id, 1]]);
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
