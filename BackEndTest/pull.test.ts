// Edge cases for recruiting (pulling) professors: the draw itself, token spending, and
// the /api/gacha/pull route. gacha.test.ts covers the basic cases.

import test from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../BackEnd/Persistence Layer/database.ts";
import { STARTING_TOKENS, createAuth, hiddenEmail } from "../BackEnd/Persistence Layer/auth.ts";
import type { PublicUser } from "../BackEnd/Persistence Layer/auth.ts";
import { GACHA_POOL, PULL_COST, buildPool, inventoryFor, levelUpProfessor, pickProfessor, pullProfessor } from "../BackEnd/Professor Gacha System/gacha.ts";
import type { InventoryItem } from "../BackEnd/Professor Gacha System/gacha.ts";
import { startBackend } from "./test-server.ts";
import type { RequestOptions } from "./test-server.ts";

/**
 * A small, seeded random number generator (mulberry32). The same seed always gives the
 * same numbers, so statistical tests give the same result on every run instead of
 * occasionally failing by chance.
 * @param seed - Any whole number.
 * @returns A function like Math.random: each call returns the next number from 0 to 1.
 */
function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Opens an in-memory database with the game and account tables.
 * @returns A promise for the open database. Call close() on it when finished.
 */
async function testDatabase(): Promise<DatabaseSync> {
    const db = openDatabase(":memory:");
    await createAuth(db, { baseURL: "http://127.0.0.1", secret: "test-secret-for-pull-tests-only-0123456789", production: false });
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

// ---------------------------------------------------------------- The draw itself

test("over many draws, each professor comes up about as often as their pull chance", () => {
    const random = seededRandom(2026);
    const draws = 200_000;
    const counts = new Map<string, number>(GACHA_POOL.map((professor) => [professor.id, 0]));
    for (let draw = 0; draw < draws; draw++) {
        const id = pickProfessor(GACHA_POOL, random).id;
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const professor of GACHA_POOL) {
        const observed = (counts.get(professor.id) ?? 0) / draws;
        // Allow 4 standard errors: a correct draw almost never misses by more than that.
        const allowed = 4 * Math.sqrt(professor.pullChance * (1 - professor.pullChance) / draws);
        assert.ok(Math.abs(observed - professor.pullChance) < allowed,
            `${professor.id}: expected ${professor.pullChance.toFixed(4)}, got ${observed.toFixed(4)}`);
    }
});

test("draws are with replacement: the same professor comes up twice in a row as often as chance predicts", () => {
    const random = seededRandom(7);
    const draws = 100_000;
    let repeats = 0;
    let previous = pickProfessor(GACHA_POOL, random).id;
    for (let draw = 1; draw < draws; draw++) {
        const current = pickProfessor(GACHA_POOL, random).id;
        if (current === previous) repeats++;
        previous = current;
    }
    // With replacement, two draws in a row match with probability Σ chance². Without
    // replacement, a professor could never follow themselves, and repeats would be 0.
    const expected = GACHA_POOL.reduce((sum, professor) => sum + professor.pullChance ** 2, 0);
    const observed = repeats / (draws - 1);
    assert.ok(Math.abs(observed - expected) < 4 * Math.sqrt(expected * (1 - expected) / draws), `expected ${expected}, got ${observed}`);
});

test("drawing never changes the pool", () => {
    const before = JSON.stringify(GACHA_POOL);
    const random = seededRandom(1);
    for (let draw = 0; draw < 1000; draw++) pickProfessor(GACHA_POOL, random);
    assert.equal(JSON.stringify(GACHA_POOL), before);
});

test("rolls at the very edges of the 0-to-1 line still pick a professor", () => {
    assert.equal(pickProfessor(GACHA_POOL, () => 0).id, GACHA_POOL[0].id);
    assert.equal(pickProfessor(GACHA_POOL, () => 1 - Number.EPSILON).id, GACHA_POOL.at(-1)?.id);
    // A roll of exactly 1 is outside Math.random's range, but rounding must never leave a roll unassigned.
    assert.equal(pickProfessor(GACHA_POOL, () => 1).id, GACHA_POOL.at(-1)?.id);
    // A roll exactly on a boundary belongs to the next professor's segment.
    const firstChance = GACHA_POOL[0].pullChance;
    assert.equal(pickProfessor(GACHA_POOL, () => firstChance).id, GACHA_POOL[1].id);
});

test("a pool with one professor always draws that professor", () => {
    const [only] = buildPool([{ id: "solo", name: "Solo", image: "/solo.png", avgRating: 3, department: "History", stats: { health: 1, attack: 1, defense: 1, speed: 1 }, copiesToLevelUp: 1 }]);
    assert.equal(only.pullChance, 1);
    for (const roll of [0, 0.5, 0.999999]) assert.equal(pickProfessor([only], () => roll).id, "solo");
});

test("professors with equal ratings get equal chances", () => {
    const entry = { image: "/x.png", avgRating: 3.5, department: "Biology", stats: { health: 1, attack: 1, defense: 1, speed: 1 }, copiesToLevelUp: 2 } as const;
    const pool = buildPool([{ ...entry, id: "x", name: "X" }, { ...entry, id: "y", name: "Y" }, { ...entry, id: "z", name: "Z" }]);
    for (const professor of pool) assert.ok(Math.abs(professor.pullChance - 1 / 3) < 1e-12);
});

// ---------------------------------------------------------------- Spending tokens

test("a player with exactly enough tokens can pull once, ending at zero", async () => {
    const db = await testDatabase();
    const userId = addPlayer(db, "Exact", PULL_COST);
    assert.equal(pullProfessor(db, userId)?.tokens, 0);
    assert.equal(pullProfessor(db, userId), undefined);
    assert.equal(tokensOf(db, userId), 0);
    assert.equal(inventoryFor(db, userId).length, 1);
    db.close();
});

test("a player one token short cannot pull, and nothing changes", async () => {
    const db = await testDatabase();
    const userId = addPlayer(db, "Short", PULL_COST - 1);
    assert.equal(pullProfessor(db, userId), undefined);
    assert.equal(tokensOf(db, userId), PULL_COST - 1);
    assert.deepEqual(inventoryFor(db, userId), []);
    assert.equal(db.isTransaction, false);
    db.close();
});

test("a new player's starting tokens buy exactly the expected number of pulls", async () => {
    const db = await testDatabase();
    const userId = addPlayer(db, "Starter", STARTING_TOKENS);
    const random = seededRandom(99);
    let pulls = 0;
    while (pullProfessor(db, userId, random)) pulls++;
    assert.equal(pulls, Math.floor(STARTING_TOKENS / PULL_COST));
    assert.equal(tokensOf(db, userId), STARTING_TOKENS % PULL_COST);
    // Every pull is either a new professor or an extra copy, so the copies add up to the pulls.
    assert.equal(inventoryFor(db, userId).reduce((sum, item) => sum + item.copies, 0), pulls);
    db.close();
});

test("if saving the professor fails, the tokens are not spent", async () => {
    const db = await testDatabase();
    const userId = addPlayer(db, "Unlucky", PULL_COST * 2);
    db.exec("CREATE TRIGGER fail_inventory_save BEFORE INSERT ON inventory BEGIN SELECT RAISE(ABORT, 'test write failure'); END;");
    assert.throws(() => pullProfessor(db, userId), /test write failure/);
    assert.equal(tokensOf(db, userId), PULL_COST * 2);
    assert.deepEqual(inventoryFor(db, userId), []);
    assert.equal(db.isTransaction, false);
    // Once saving works again, pulling works normally.
    db.exec("DROP TRIGGER fail_inventory_save");
    assert.equal(pullProfessor(db, userId)?.tokens, PULL_COST);
    db.close();
});

test("a player cannot level up a professor that only another player owns", async () => {
    const db = await testDatabase();
    const owner = addPlayer(db, "Owner", PULL_COST * 10);
    const other = addPlayer(db, "Other", 0);
    for (let pull = 0; pull < 10; pull++) pullProfessor(db, owner, () => 0);
    assert.equal(levelUpProfessor(db, other, GACHA_POOL[0].id), undefined);
    assert.equal(inventoryFor(db, owner)[0].copies, 10);
    db.close();
});

// ---------------------------------------------------------------- The /api/gacha/pull route

test("through the API, a new account gets exactly its starting pulls, with matching balances", async (t) => {
    const backend = await startBackend();
    t.after(() => backend.close());
    const { cookie, user } = await backend.signUp("FreshPuller");
    const expectedPulls = Math.floor(STARTING_TOKENS / PULL_COST);
    for (let pull = 1; pull <= expectedPulls; pull++) {
        const result = await backend.api<{ item: InventoryItem; isNew: boolean; user: PublicUser }>("gacha/pull", { body: {}, cookie });
        assert.equal(result.response.status, 200);
        assert.equal(result.data.user.tokens, STARTING_TOKENS - pull * PULL_COST);
        assert.equal(result.data.isNew, result.data.item.copies === 1);
        assert.equal(backend.tokensOf(user.id), result.data.user.tokens);
    }
    const broke = await backend.api("gacha/pull", { body: {}, cookie });
    assert.equal(broke.response.status, 409);
    assert.equal(backend.tokensOf(user.id), STARTING_TOKENS % PULL_COST);
    const inventory = await backend.api<{ inventory: InventoryItem[] }>("inventory", { cookie });
    assert.equal(inventory.data.inventory.reduce((sum, item) => sum + item.copies, 0), expectedPulls);
});

test("pull requests that are rejected never spend tokens", async (t) => {
    const backend = await startBackend();
    t.after(() => backend.close());
    const { cookie, user } = await backend.signUp("CarefulPuller");
    const rejected: { name: string; options: RequestOptions; status: number }[] = [
        { name: "from another website", options: { body: {}, cookie, headers: { Origin: "https://another-site.example" } }, status: 403 },
        { name: "marked cross-site by the browser", options: { body: {}, cookie, headers: { "Sec-Fetch-Site": "cross-site" } }, status: 403 },
        { name: "not JSON", options: { rawBody: "{}", cookie, headers: { "Content-Type": "text/plain" } }, status: 415 },
        { name: "malformed JSON", options: { rawBody: "{", cookie }, status: 400 },
        { name: "a JSON array", options: { rawBody: "[]", cookie }, status: 400 },
        { name: "too large", options: { body: { padding: "x".repeat(9000) }, cookie }, status: 413 },
        { name: "with GET", options: { cookie, method: "GET" }, status: 405 },
        { name: "without a cookie", options: { body: {} }, status: 401 },
        { name: "with an invented cookie", options: { body: {}, cookie: "professor-go.session_token=invented" }, status: 401 },
    ];
    for (const { name, options, status } of rejected) {
        const result = await backend.api("gacha/pull", options);
        assert.equal(result.response.status, status, name);
        assert.equal(backend.tokensOf(user.id), STARTING_TOKENS, `tokens changed for a pull ${name}`);
    }
    assert.equal((await backend.api("gacha/pull", { cookie, method: "GET" })).response.headers.get("allow"), "POST");
});

test("an account deactivated after logging in cannot pull with its old session", async (t) => {
    const backend = await startBackend();
    t.after(() => backend.close());
    const { cookie, user } = await backend.signUp("Benched");
    backend.db.prepare('UPDATE "user" SET isActive = 0 WHERE id = ?').run(user.id);
    assert.equal((await backend.api("gacha/pull", { body: {}, cookie })).response.status, 401);
    assert.equal(backend.tokensOf(user.id), STARTING_TOKENS);
});

test("the public pool lists every professor with chances that add up to 1, and supports HEAD", async (t) => {
    const backend = await startBackend();
    t.after(() => backend.close());
    const pool = await backend.api<{ cost: number; professors: { id: string; pullChance: number }[] }>("gacha/pool");
    assert.equal(pool.data.cost, PULL_COST);
    assert.equal(pool.data.professors.length, GACHA_POOL.length);
    assert.ok(Math.abs(pool.data.professors.reduce((sum, professor) => sum + professor.pullChance, 0) - 1) < 1e-12);
    const head = await fetch(`${backend.url}/api/gacha/pool`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
});

test("levelling up through the API rejects missing, mistyped, and unknown professor ids", async (t) => {
    const backend = await startBackend();
    t.after(() => backend.close());
    const { cookie } = await backend.signUp("Tinkerer");
    for (const body of [{}, { professorId: null }, { professorId: 42 }, { professorId: ["dr-quark"] }, { professorId: "not-a-professor" }, { professorId: GACHA_POOL[0].id }]) {
        assert.equal((await backend.api("inventory/level-up", { body, cookie })).response.status, 404, JSON.stringify(body));
    }
});
