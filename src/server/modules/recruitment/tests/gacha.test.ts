import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../../storage/database.ts";
import { createAuth, hiddenEmail } from "../../accounts/infrastructure/betterAuth.ts";
import {
    EPIC_CHANCE, GACHA_CAGES, GACHA_POOL, LEGENDARY_CHANCE, PULL_COST,
    buildPool, inventoryFor, legendaryChance, levelUpProfessor, pickProfessor, pityFor, pullGacha, pullOdds, rarityFor,
} from "../application/recruitment.ts";
import type { Rarity } from "../application/recruitment.ts";
import { PROFESSOR_POOL } from "../domain/professors.ts";
import type { ProfessorEntry } from "../domain/professors.ts";

// A roll of 0 always draws this professor: the first Legendary in the pool.
const FIRST_LEGENDARY = GACHA_POOL.filter((professor) => professor.rarity === "Legendary")[0];
// A roll just under 1 draws this professor when no pity applies: the last Rare or Common professor in the pool.
const LAST_OTHER = GACHA_POOL.filter((professor) => professor.rarity === "Rare" || professor.rarity === "Common").at(-1)!;

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
 * @returns The pull's result.
 */
function pullLegendary(db: DatabaseSync, userId: string) {
    const pull = pullGacha(db, userId, () => 0);
    assert.ok(pull);
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

test("every professor can be pulled, the base chances add up to 1, and the cage follows rarity", () => {
    assert.equal(GACHA_POOL.length, PROFESSOR_POOL.length);
    // Adds up the base pull chances of every professor of one rarity.
    const chanceOf = (rarity: Rarity) => GACHA_POOL.filter((professor) => professor.rarity === rarity)
        .reduce((sum, professor) => sum + professor.pullChance, 0);
    assertClose(chanceOf("Legendary"), LEGENDARY_CHANCE);
    assertClose(chanceOf("Epic"), EPIC_CHANCE);
    assertClose(chanceOf("Rare") + chanceOf("Common"), 1 - LEGENDARY_CHANCE - EPIC_CHANCE);
    // Rare and Common professors share the rest equally.
    const others = GACHA_POOL.filter((professor) => professor.rarity === "Rare" || professor.rarity === "Common");
    for (const professor of others) assertClose(professor.pullChance, others[0].pullChance);
    for (const professor of GACHA_POOL) assert.equal(professor.rarity, rarityFor(professor.avgRating));

    assert.deepEqual(GACHA_CAGES.map((cage) => cage.id), ["golden-cage", "iron-cage", "bronze-cage"]);
    const cageOf: Record<Rarity, string> = { Legendary: "golden-cage", Epic: "iron-cage", Rare: "bronze-cage", Common: "bronze-cage" };
    for (const professor of GACHA_POOL) assert.equal(professor.cage.id, cageOf[professor.rarity]);
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
    // Two Legendary professors, one Epic, one Rare, and one Common.
    const pool = buildPool([entry("a", 5), entry("b", 4.6), entry("c", 4), entry("d", 3), entry("e", 2)]);
    // Draws from the test pool with a fixed roll and returns the id of the professor.
    const draw = (legendary: number, epic: number, roll: number) => pickProfessor({ legendary, epic }, () => roll, pool).id;

    const odds = pullOdds({ legendary: 0, epic: 0 }, pool);
    assert.deepEqual(odds.map((entry) => entry.professor.id), ["a", "b", "c", "d", "e"]);
    [0.0004, 0.0004, 0.05, 0.9492 / 2, 0.9492 / 2].forEach((chance, index) => assertClose(odds[index].chance, chance));
    assertClose(odds.reduce((sum, entry) => sum + entry.chance, 0), 1);
    assert.deepEqual([0, 0.0005, 0.03, 0.06, 0.6, 0.999999].map((roll) => draw(0, 0, roll)), ["a", "b", "c", "d", "e", "e"]);

    // The 10th pull without an Epic or a Legendary is an Epic unless it is a Legendary, so no Rare or Common can be drawn.
    assert.equal(draw(0, 8, 0.999999), "e");
    assert.equal(draw(0, 9, 0.999999), "c");
    assert.equal(draw(0, 9, 0), "a");
    assert.deepEqual(pullOdds({ legendary: 0, epic: 9 }, pool).slice(3).map((entry) => entry.chance), [0, 0]);
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
    assert.throws(() => buildPool([entry("legendary", 5), entry("epic", 4)]), /Rare or Common/);
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

test("pulling spends tokens and saves the professor, or changes nothing when unaffordable", async () => {
    const db = await testDatabase();
    const userId = addPlayer(db, "Puller", PULL_COST * 2 + 5);
    // Returns the ids of the professors in the test player's inventory, in the order they were first pulled.
    const owned = () => inventoryFor(db, userId).map((item) => item.professor.id);
    assert.deepEqual(pityFor(db, userId), { legendary: 0, epic: 0 });

    const first = pullLegendary(db, userId);
    assert.equal(first.item.professor.id, FIRST_LEGENDARY.id);
    assert.equal(first.item.level, 1);
    assert.equal(first.item.copies, 1);
    assert.equal(first.isNew, true);
    assert.equal(first.item.professor.cage.id, "golden-cage");
    assert.equal(first.tokens, PULL_COST + 5);
    assert.deepEqual(first.pity, { legendary: 0, epic: 0 });
    const second = pullGacha(db, userId, () => 0.999999);
    assert.ok(second);
    assert.equal(second.item.professor.id, LAST_OTHER.id);
    assert.equal(second.item.professor.cage.id, "bronze-cage");
    assert.equal(second.isNew, true);
    assert.equal(second.tokens, 5);
    assert.deepEqual(second.pity, { legendary: 1, epic: 1 });

    assert.equal(pullGacha(db, userId), undefined);
    assert.equal(tokensOf(db, userId), 5);
    assert.deepEqual(owned(), [FIRST_LEGENDARY.id, LAST_OTHER.id]);
    assert.deepEqual(pityFor(db, userId), { legendary: 1, epic: 1 });
    assert.deepEqual(inventoryFor(db, userId)[0], first.item);
    assert.equal(db.isTransaction, false);
    assert.equal(pullGacha(db, "no-such-player"), undefined);
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

test("pity is saved between pulls and guarantees an Epic or Legendary every 10 pulls and a Legendary by pull 80", async () => {
    const db = await testDatabase();
    const userId = addPlayer(db, "Unlucky", PULL_COST * 80);
    // The highest roll always draws the last professor that is still possible: a Rare or Common
    // professor, or an Epic or Legendary once pity rules the others out.
    const cages = Array.from({ length: 80 }, () => pullGacha(db, userId, () => 0.999999)?.item.professor.cage.id);
    // Returns the numbers of the pulls, counting from 1, that came in the given cage.
    const pullsIn = (cage: string) => cages.flatMap((drawn, index) => drawn === cage ? [index + 1] : []);
    // Pull 79 is an Epic too: by then the Legendary chance is over 95%, leaving no room for the others.
    assert.deepEqual(pullsIn("iron-cage"), [10, 20, 30, 40, 50, 60, 70, 79]);
    assert.deepEqual(pullsIn("golden-cage"), [80]);
    assert.equal(pullsIn("bronze-cage").length, 71);
    // The Legendary on pull 80 restarts both counts.
    assert.deepEqual(pityFor(db, userId), { legendary: 0, epic: 0 });
    assert.equal(tokensOf(db, userId), 0);
    db.close();
});

test("a Legendary restarts the count toward the guaranteed Epic or Legendary", async () => {
    const db = await testDatabase();
    const userId = addPlayer(db, "Lucky", PULL_COST * 2);
    db.prepare("INSERT INTO gacha_pity (user_id, legendary_pity, epic_pity) VALUES (?, 6, 6)").run(userId);
    assert.deepEqual(pullLegendary(db, userId).pity, { legendary: 0, epic: 0 });
    assert.deepEqual(pullGacha(db, userId, () => 0.999999)?.pity, { legendary: 1, epic: 1 });
    db.close();
});

test("pulling a professor the player already owns adds a copy", async () => {
    const db = await testDatabase();
    const userId = addPlayer(db, "Collector", PULL_COST * 3);
    const pulls = [0, 1, 2].map(() => pullLegendary(db, userId));
    assert.deepEqual(pulls.map((pull) => [pull.isNew, pull.item.copies, pull.item.level]), [[true, 1, 1], [false, 2, 1], [false, 3, 1]]);
    assert.equal(pulls[2].item.obtainedAt, pulls[0].item.obtainedAt);
    assert.deepEqual(inventoryFor(db, userId).map((item) => [item.professor.id, item.copies]), [[FIRST_LEGENDARY.id, 3]]);
    assert.throws(() => db.prepare("INSERT INTO inventory (user_id, professor_id) VALUES (?, ?)").run(userId, FIRST_LEGENDARY.id), /UNIQUE constraint failed/);
    db.close();
});

test("levelling up spends copiesToLevelUp copies and always keeps one", async () => {
    const db = await testDatabase();
    const professor = FIRST_LEGENDARY;
    const needed = professor.copiesToLevelUp;
    const userId = addPlayer(db, "Leveler", PULL_COST * (2 * needed + 1));

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

test("each player's copies and levels are separate, and professors no longer in the pool are left out", async () => {
    const db = await testDatabase();
    const alice = addPlayer(db, "Alice", PULL_COST * 2);
    const bob = addPlayer(db, "Bob", PULL_COST);
    pullLegendary(db, alice);
    pullLegendary(db, alice);
    assert.equal(pullLegendary(db, bob).isNew, true);
    db.prepare("INSERT INTO inventory (user_id, professor_id) VALUES (?, 'retired-professor')").run(bob);
    assert.deepEqual(inventoryFor(db, alice).map((item) => item.copies), [2]);
    assert.deepEqual(inventoryFor(db, bob).map((item) => [item.professor.id, item.copies]), [[FIRST_LEGENDARY.id, 1]]);
    // Removing an account removes its inventory and pity too.
    db.prepare('DELETE FROM "user" WHERE id = ?').run(bob);
    assert.deepEqual(inventoryFor(db, bob), []);
    assert.deepEqual(pityFor(db, bob), { legendary: 0, epic: 0 });
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
