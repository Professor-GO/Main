// Edge cases for signing up: username and password rules, what new accounts start with,
// and what the server ignores or keeps private. auth.test.ts covers the basic account flow.

import test from "node:test";
import assert from "node:assert/strict";
import { STARTING_TOKENS, hiddenEmail } from "../BackEnd/Persistence Layer/auth.ts";
import type { PublicUser } from "../BackEnd/Persistence Layer/auth.ts";
import { TEST_PASSWORD, startBackend } from "./test-server.ts";
import type { TestBackend } from "./test-server.ts";

type AccountResponse = { user: PublicUser; message?: string };

/**
 * Starts a backend for one test and stops it when the test ends.
 * @param t - The running test.
 * @returns A promise for the backend.
 */
async function backendFor(t: { after: (fn: () => Promise<void>) => void }): Promise<TestBackend> {
    const backend = await startBackend();
    t.after(() => backend.close());
    return backend;
}

test("usernames: 3–20 letters, numbers, or underscores are accepted at both ends of the range", async (t) => {
    const backend = await backendFor(t);
    for (const username of ["abc", "A".repeat(20), "___", "123", "Mix_3d_Case", "x_y"]) {
        const result = await backend.api<AccountResponse>("auth/register", { body: { username, password: TEST_PASSWORD } });
        assert.equal(result.response.status, 201, username);
        assert.equal(result.data.user.username, username);
    }
});

test("usernames: too short, too long, or with other characters are rejected", async (t) => {
    const backend = await backendFor(t);
    const rejected = ["", "ab", "A".repeat(21), "has space", "dash-name", "dot.name", "émile", "名字名字", "emoji🎲", "semi;colon", "<script>", "tab\tname"];
    for (const username of rejected) {
        const result = await backend.api<AccountResponse>("auth/register", { body: { username, password: TEST_PASSWORD } });
        assert.equal(result.response.status, 400, JSON.stringify(username));
        assert.equal(result.data.message, "Your username needs 3–20 letters, numbers, or underscores.");
    }
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM "user"').get()?.n, 0);
});

test("usernames: spaces around the name are trimmed, and still count as the same name", async (t) => {
    const backend = await backendFor(t);
    const padded = await backend.api<AccountResponse>("auth/register", { body: { username: "  Padded  ", password: TEST_PASSWORD } });
    assert.equal(padded.response.status, 201);
    assert.equal(padded.data.user.username, "Padded");
    // The same name in a different case, with different padding, is still taken.
    assert.equal((await backend.api("auth/register", { body: { username: " PADDED", password: TEST_PASSWORD } })).response.status, 409);
    assert.equal((await backend.api("auth/login", { body: { username: "padded  ", password: TEST_PASSWORD } })).response.status, 200);
});

test("passwords: 8 and 128 characters are accepted; 7 and 129 are rejected", async (t) => {
    const backend = await backendFor(t);
    const cases = [{ length: 7, status: 400 }, { length: 8, status: 201 }, { length: 128, status: 201 }, { length: 129, status: 400 }];
    for (const [index, { length, status }] of cases.entries()) {
        const result = await backend.api<AccountResponse>("auth/register", { body: { username: `Length${index}`, password: "p".repeat(length) } });
        assert.equal(result.response.status, status, `${length} characters`);
        if (status === 400) assert.equal(result.data.message, "Your password needs 8–128 characters.");
    }
});

test("passwords are used exactly as typed: spaces are kept and non-English characters work", async (t) => {
    const backend = await backendFor(t);
    for (const [username, password] of [["Spacey", "  two words  "], ["Unicode", "pässwörd-日本-🎲"]]) {
        assert.equal((await backend.api("auth/register", { body: { username, password } })).response.status, 201, username);
        assert.equal((await backend.api("auth/login", { body: { username, password } })).response.status, 200, username);
        // A trimmed or otherwise changed password is a different password.
        assert.equal((await backend.api("auth/login", { body: { username, password: password.trim() + "x" } })).response.status, 401, username);
    }
    assert.equal((await backend.api("auth/login", { body: { username: "Spacey", password: "two words" } })).response.status, 401);
});

test("sign-up rejects missing fields and values of the wrong type", async (t) => {
    const backend = await backendFor(t);
    const bodies = [
        {}, { username: "NoPassword" }, { password: TEST_PASSWORD },
        { username: 12345, password: TEST_PASSWORD }, { username: ["Alice"], password: TEST_PASSWORD }, { username: null, password: TEST_PASSWORD },
        { username: "NumberPass", password: 12345678 }, { username: "ObjectPass", password: { value: TEST_PASSWORD } },
    ];
    for (const body of bodies) {
        assert.equal((await backend.api("auth/register", { body })).response.status, 400, JSON.stringify(body));
    }
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM "user"').get()?.n, 0);
});

test("a new account starts active, with the starting tokens and an empty inventory", async (t) => {
    const backend = await backendFor(t);
    const { cookie, user } = await backend.signUp("Newbie");
    assert.equal(user.tokens, STARTING_TOKENS);
    assert.equal(user.isActive, true);
    assert.ok(Math.abs(Date.parse(user.createdAt) - Date.now()) < 60_000, "createdAt is about now");
    assert.deepEqual((await backend.api<{ inventory: unknown[] }>("inventory", { cookie })).data.inventory, []);
    assert.equal((await backend.api<AccountResponse>("auth/me", { cookie })).data.user.id, user.id);
});

test("sign-up ignores attempts to set tokens, status, email, or id", async (t) => {
    const backend = await backendFor(t);
    const result = await backend.api<AccountResponse>("auth/register", {
        body: { username: "Sneaky", password: TEST_PASSWORD, tokens: 999_999, isActive: false, email: "real@example.com", id: "chosen-id", emailVerified: true, displayUsername: "Admin" },
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.data.user.tokens, STARTING_TOKENS);
    assert.equal(result.data.user.isActive, true);
    assert.equal(result.data.user.username, "Sneaky");
    assert.notEqual(result.data.user.id, "chosen-id");
    const stored = backend.db.prepare('SELECT email, emailVerified, tokens, isActive FROM "user" WHERE id = ?').get(result.data.user.id);
    assert.deepEqual({ ...stored }, { email: hiddenEmail("Sneaky"), emailVerified: 0, tokens: STARTING_TOKENS, isActive: 1 });
});

test("sign-up responses never include the password, its hash, or the hidden email", async (t) => {
    const backend = await backendFor(t);
    const password = "unique-password-to-look-for";
    const result = await backend.api<AccountResponse>("auth/register", { body: { username: "Private", password } });
    const raw = JSON.stringify(result.data);
    assert.deepEqual(Object.keys(result.data.user).sort(), ["createdAt", "id", "isActive", "tokens", "username"]);
    const hash = (backend.db.prepare("SELECT password FROM account WHERE userId = ?").get(result.data.user.id) as { password: string }).password;
    for (const secret of [password, hash, hiddenEmail("Private"), "invalid"]) assert.ok(!raw.includes(secret), `response leaked ${secret}`);
});

test("signing up while logged in switches the browser to the new account", async (t) => {
    const backend = await backendFor(t);
    const first = await backend.signUp("FirstPlayer");
    const second = await backend.api<AccountResponse>("auth/register", { body: { username: "SecondPlayer", password: TEST_PASSWORD }, cookie: first.cookie });
    assert.equal(second.response.status, 201);
    assert.ok(second.cookie && second.cookie !== first.cookie);
    assert.equal((await backend.api<AccountResponse>("auth/me", { cookie: second.cookie })).data.user.username, "SecondPlayer");
});

test("many players signing up at once each get their own account, and duplicates get exactly one", async (t) => {
    const backend = await backendFor(t);
    const names = Array.from({ length: 10 }, (_, index) => `Rush${index}`);
    const statuses = await Promise.all([...names, "Rush0", "RUSH0", "rush0"].map(async (username) =>
        (await backend.api("auth/register", { body: { username, password: TEST_PASSWORD } })).response.status));
    assert.equal(statuses.filter((status) => status === 201).length, names.length);
    assert.equal(statuses.filter((status) => status === 409).length, 3);
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM "user"').get()?.n, names.length);
});
