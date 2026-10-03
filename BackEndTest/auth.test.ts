import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, tokenHash, userById, STARTING_TOKENS } from "../BackEnd/database.ts";
import type { PublicUser } from "../BackEnd/database.ts";
import { GACHA_POOL, PULL_COST } from "../BackEnd/Professor Gacha System/gacha.ts";
import type { InventoryItem } from "../BackEnd/Professor Gacha System/gacha.ts";

type AccountResponse = { user: PublicUser };
type ApiOptions = {
    body?: unknown;
    cookie?: string;
    headers?: Record<string, string>;
    method?: string;
};

const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * Finds a port that nothing is using, so test servers never clash with a running copy of the app.
 * @returns A promise for an unused port number on 127.0.0.1.
 */
async function freePort(): Promise<number> {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    assert.ok(address && typeof address !== "string");
    return address.port;
}

test("account lifecycle through the website's backend proxy", { timeout: 30_000 }, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "professor-go-test-"));
    const databasePath = join(directory, "accounts.sqlite");
    const frontendPort = await freePort();
    let backendPort = await freePort();
    while (backendPort === frontendPort) backendPort = await freePort();
    const origin = `http://127.0.0.1:${frontendPort}`;
    const password = "correct-horse-42";
    let child: ChildProcess | undefined;
    const db = openDatabase(databasePath);

    /**
     * Starts the app in a child process using the temporary test database, and
     * waits until it reports that it is ready.
     * @param environment - The APP_ENV to run with: "test" (default) or "production".
     * @returns A promise that resolves once the servers are listening.
     */
    async function start(environment = "test") {
        const serverProcess = spawn(process.execPath, ["BackEnd/server.ts"], {
            cwd: root,
            env: { ...process.env, APP_ENV: environment, FRONTEND_HOST: "127.0.0.1", FRONTEND_PORT: String(frontendPort), BACKEND_HOST: "127.0.0.1", BACKEND_PORT: String(backendPort), DATABASE_PATH: databasePath },
            stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
        });
        child = serverProcess;
        await new Promise<void>((done, reject) => {
            let output = "";
            const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 8000);
            serverProcess.stdout.on("data", (data: Buffer) => {
                output += data;
                if (output.includes("Press Ctrl+C")) { clearTimeout(timer); done(); }
            });
            serverProcess.stderr.on("data", (data: Buffer) => { output += data; });
            serverProcess.once("error", (error) => { clearTimeout(timer); reject(error); });
            serverProcess.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${output}`)); });
        });
    }
    /**
     * Stops the app started by start(), if it is still running.
     * @returns A promise that resolves once the process has exited.
     */
    async function stop() {
        if (!child || child.exitCode !== null) return;
        const exited = once(child, "exit");
        child.kill();
        await exited;
    }
    /**
     * Sends a request to the test app's API through the frontend server, like the website does.
     * @param path - The route after "/api/", such as "auth/login".
     * @param options - body: JSON to send (makes it a POST); cookie: the session cookie to send;
     * headers: extra request headers; method: overrides the HTTP method.
     * @returns A promise for the raw response, its parsed JSON data (typed as T), and the
     * session cookie the server set, if any.
     */
    async function api<T = Record<string, unknown>>(path: string, { body, cookie, headers = {}, method }: ApiOptions = {}) {
        const response = await fetch(`${origin}/api/${path}`, {
            method: method ?? (body === undefined ? "GET" : "POST"),
            headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = await response.json() as T;
        return { response, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
    }
    t.after(async () => {
        db.close();
        await stop();
        // Only remove the test directory created above, within the system temp folder.
        assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
        assert.ok(directory.includes("professor-go-test-"));
        await rm(directory, { recursive: true, force: true });
    });
    await start();
    let userCookie: string | undefined;
    let userId: number;

    await t.test("serves the UI and health; keeps backend files private", async () => {
        const page = await fetch(origin);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /Professor-Go/);
        const health = await api("health");
        assert.equal(health.data.database, "connected");
        for (const path of ["/.env", "/BackEnd/data/game.sqlite", "/BackEnd/server.ts", "/BackEnd/schema.sql"]) {
            assert.equal((await fetch(origin + path)).status, 404);
        }
        assert.equal((await api("auth/login")).response.status, 405);
        assert.equal((await api("auth/me")).response.status, 401);
    });

    await t.test("signup persists all requested fields and issues an opaque cookie", async () => {
        const result = await api<AccountResponse>("auth/register", { body: { username: "TestPlayer", password }, headers: { Origin: origin } });
        assert.equal(result.response.status, 201);
        assert.equal(result.data.user.username, "TestPlayer");
        assert.equal(result.data.user.isActive, true);
        assert.ok(Number.isFinite(Date.parse(result.data.user.createdAt)));
        assert.equal(result.data.user.tokens, STARTING_TOKENS);
        assert.deepEqual(Object.keys(result.data.user).sort(), ["createdAt", "id", "isActive", "tokens", "username"]);
        assert.match(result.response.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Lax; Path=\/; Max-Age=604800/);
        userCookie = result.cookie;
        assert.ok(userCookie);
        userId = result.data.user.id;
        const stored = userById(db, userId);
        assert.ok(stored);
        assert.match(stored.password_hash, /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
        assert.ok(!stored.password_hash.includes(password));
        assert.equal(stored.created_at, result.data.user.createdAt);
        assert.equal(stored.is_active, 1);
        assert.equal(stored.tokens, STARTING_TOKENS);
        const session = db.prepare("SELECT * FROM sessions WHERE user_id = ?").get(userId);
        assert.ok(session);
        assert.equal(session.token_hash, tokenHash(userCookie.split("=")[1]));
        assert.equal((await api<AccountResponse>("auth/me", { cookie: userCookie })).data.user.id, userId);
    });

    await t.test("usernames are unique without regard to case, including concurrent signups", async () => {
        assert.equal((await api("auth/register", { body: { username: "testplayer", password } })).response.status, 409);
        const results = await Promise.all(["Concurrent", "CONCURRENT"].map((username) => api("auth/register", { body: { username, password } })));
        assert.deepEqual(results.map((result) => result.response.status).sort(), [201, 409]);
    });

    await t.test("rejects bad inputs, malformed JSON, large requests and cross-site requests", async () => {
        for (const body of [{}, { username: "a", password }, { username: "valid_name", password: "short" }, { username: "valid_name", password: "x".repeat(129) }, { username: "a' OR 1=1--", password }, null, []]) {
            assert.equal((await api("auth/register", { body })).response.status, 400);
        }
        assert.equal((await api("auth/login", { body: { username: "TestPlayer", password }, headers: { Origin: "https://another-site.example" } })).response.status, 403);
        assert.equal((await api("auth/login", { body: { username: "TestPlayer", password }, headers: { "Content-Type": "text/plain" } })).response.status, 415);
        const malformed = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
        assert.equal(malformed.status, 400);
        assert.equal((await api("auth/login", { body: { username: "TestPlayer", password, extra: "x".repeat(9000) } })).response.status, 413);
    });

    await t.test("login checks passwords and accepts username case variants", async () => {
        for (const username of ["TestPlayer", "UnknownPlayer"]) {
            const result = await api("auth/login", { body: { username, password: "wrong-password" } });
            assert.equal(result.response.status, 401);
            assert.equal(result.data.message, "That username and password do not match.");
            assert.equal(result.cookie, undefined);
        }
        const result = await api("auth/login", { body: { username: "testplayer", password }, cookie: userCookie });
        assert.equal(result.response.status, 200);
        assert.equal((await api("auth/me", { cookie: userCookie })).response.status, 401);
        userCookie = result.cookie;
    });

    await t.test("accounts and sessions survive a server restart", async () => {
        await stop();
        await start();
        const result = await api<AccountResponse>("auth/me", { cookie: userCookie });
        assert.equal(result.response.status, 200);
        assert.equal(result.data.user.id, userId);
    });

    await t.test("token balances are stored, returned, and never negative", async () => {
        db.prepare("UPDATE users SET tokens = 25 WHERE id = ?").run(userId);
        assert.equal((await api<AccountResponse>("auth/me", { cookie: userCookie })).data.user.tokens, 25);
        assert.throws(() => db.prepare("UPDATE users SET tokens = -1 WHERE id = ?").run(userId), /CHECK constraint failed/);
        assert.equal(userById(db, userId)?.tokens, 25);
        db.prepare("UPDATE users SET tokens = 0 WHERE id = ?").run(userId);
    });

    await t.test("the gacha pool is public and pulls spend the player's tokens", async () => {
        const pool = await api<{ cost: number; professors: { id: string; pullChance: number }[] }>("gacha/pool");
        assert.equal(pool.response.status, 200);
        assert.equal(pool.data.cost, PULL_COST);
        assert.deepEqual(pool.data.professors.map((professor) => professor.id), GACHA_POOL.map((professor) => professor.id));
        assert.equal((await api("gacha/pull", { body: {} })).response.status, 401);
        const broke = await api("gacha/pull", { body: {}, cookie: userCookie });
        assert.equal(broke.response.status, 409);
        assert.equal(broke.data.message, `You need ${PULL_COST} tokens to recruit a professor.`);

        db.prepare("UPDATE users SET tokens = ? WHERE id = ?").run(PULL_COST + 3, userId);
        const pull = await api<AccountResponse & { item: InventoryItem; isNew: boolean }>("gacha/pull", { body: {}, cookie: userCookie });
        assert.equal(pull.response.status, 200);
        assert.equal(pull.data.user.tokens, 3);
        assert.equal(pull.data.item.level, 1);
        assert.equal(pull.data.isNew, true);
        assert.ok(GACHA_POOL.some((professor) => professor.id === pull.data.item.professor.id));
        const owned = db.prepare("SELECT professor_id FROM inventory WHERE user_id = ?").all(userId);
        assert.deepEqual(owned.map((row) => row.professor_id), [pull.data.item.professor.id]);
        assert.equal((await api("gacha/pull", { body: {}, cookie: userCookie })).response.status, 409);
        db.prepare("UPDATE users SET tokens = 0 WHERE id = ?").run(userId);
    });

    await t.test("players can only see their own inventory, with each professor's level", async () => {
        assert.equal((await api("inventory")).response.status, 401);
        const mine = await api<{ inventory: InventoryItem[] }>("inventory", { cookie: userCookie });
        assert.equal(mine.response.status, 200);
        assert.equal(mine.data.inventory.length, 1);
        assert.equal(mine.data.inventory[0].level, 1);
        db.prepare("UPDATE inventory SET level = 7 WHERE user_id = ?").run(userId);
        assert.equal((await api<{ inventory: InventoryItem[] }>("inventory", { cookie: userCookie })).data.inventory[0].level, 7);
        assert.throws(() => db.prepare("UPDATE inventory SET level = 0 WHERE user_id = ?").run(userId), /CHECK constraint failed/);
        const other = await api<{ inventory: InventoryItem[] }>("inventory", {
            cookie: (await api("auth/register", { body: { username: "SecondPlayer", password } })).cookie,
        });
        assert.deepEqual(other.data.inventory, []);
    });

    await t.test("players level up a professor by spending enough copies", async () => {
        const item = (await api<{ inventory: InventoryItem[] }>("inventory", { cookie: userCookie })).data.inventory[0];
        const levelUp = (professorId: unknown, cookie = userCookie) => api<{ item: InventoryItem; message: string }>("inventory/level-up", { body: { professorId }, cookie });
        assert.equal((await levelUp(item.professor.id, "")).response.status, 401);
        assert.equal((await levelUp(42)).response.status, 404);
        const notOwned = GACHA_POOL.find((professor) => professor.id !== item.professor.id);
        assert.equal((await levelUp(notOwned?.id)).response.status, 404);

        const short = await levelUp(item.professor.id);
        assert.equal(short.response.status, 409);
        const missing = item.professor.copiesToLevelUp;
        assert.equal(short.data.message, `Collect ${missing} more ${missing === 1 ? "copy" : "copies"} of ${item.professor.name} to level them up.`);

        db.prepare("UPDATE inventory SET copies = ? WHERE user_id = ?").run(item.professor.copiesToLevelUp + 1, userId);
        const levelled = await levelUp(item.professor.id);
        assert.equal(levelled.response.status, 200);
        assert.deepEqual([levelled.data.item.level, levelled.data.item.copies], [item.level + 1, 1]);
    });

    await t.test("inactive accounts cannot sign in or use an existing session", async () => {
        db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(userId);
        assert.equal((await api("auth/me", { cookie: userCookie })).response.status, 401);
        assert.equal((await api("auth/login", { body: { username: "TestPlayer", password } })).response.status, 403);
        assert.equal((await api("auth/login", { body: { username: "TestPlayer", password: "wrong-password" } })).response.status, 401);
        db.prepare("UPDATE users SET is_active = 1 WHERE id = ?").run(userId);
        const login = await api("auth/login", { body: { username: "TestPlayer", password } });
        assert.equal(login.response.status, 200);
        userCookie = login.cookie;
    });

    await t.test("logout revokes the session on the server", async () => {
        const result = await api("auth/logout", { body: {}, cookie: userCookie });
        assert.equal(result.response.status, 200);
        assert.match(result.response.headers.get("set-cookie") ?? "", /Max-Age=0/);
        assert.equal((await api("auth/me", { cookie: userCookie })).response.status, 401);
    });

    await t.test("expired or invented sessions are rejected", async () => {
        const login = await api("auth/login", { body: { username: "TestPlayer", password } });
        db.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = ?").run(Date.now() - 1000, userId);
        assert.equal((await api("auth/me", { cookie: login.cookie })).response.status, 401);
        assert.equal((await api("auth/me", { cookie: "arena_session=fake" })).response.status, 401);
    });

    await t.test("the account-status command revokes sessions and supports reactivation", async () => {
        const login = await api("auth/login", { body: { username: "TestPlayer", password } });
        for (const status of ["inactive", "active"]) {
            const result = await promisify(execFile)(process.execPath, ["BackEnd/account-status.ts", "testplayer", status], {
                cwd: root, env: { ...process.env, DATABASE_PATH: databasePath }, windowsHide: true,
            });
            assert.match(result.stdout, new RegExp(`is now ${status}`));
            assert.equal((await api("auth/me", { cookie: login.cookie })).response.status, 401);
        }
        assert.equal((await api("auth/login", { body: { username: "TestPlayer", password } })).response.status, 200);
    });

    await t.test("production sessions use Secure cookies", async () => {
        await stop();
        await start("production");
        const result = await api("auth/login", { body: { username: "TestPlayer", password } });
        assert.equal(result.response.status, 200);
        assert.match(result.response.headers.get("set-cookie") ?? "", /; Secure$/);
    });

    await t.test("repeated authentication attempts are rate limited", async () => {
        let status: number | undefined;
        for (let index = 0; index < 61; index++) status = (await api("auth/login", { body: {} })).response.status;
        assert.equal(status, 429);
    });
});

test("older databases gain a zero token balance without losing accounts", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "professor-go-test-"));
    t.after(async () => {
        assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
        await rm(directory, { recursive: true, force: true });
    });
    const databasePath = join(directory, "legacy.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL COLLATE NOCASE UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
        );
        INSERT INTO users (username, password_hash) VALUES ('Veteran', 'scrypt:aa:bb');
    `);
    legacy.close();
    for (let opening = 0; opening < 2; opening++) {
        const db = openDatabase(databasePath);
        const user = userById(db, 1);
        db.close();
        assert.equal(user?.username, "Veteran");
        assert.equal(user?.tokens, 0);
    }
});

test("the schema's default token balance matches STARTING_TOKENS", () => {
    const db = openDatabase(":memory:");
    const id = db.prepare("INSERT INTO users (username, password_hash) VALUES ('Newcomer', 'scrypt:aa:bb')").run().lastInsertRowid;
    assert.equal(userById(db, id)?.tokens, STARTING_TOKENS);
    db.close();
});
