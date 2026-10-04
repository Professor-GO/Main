/** Verifies startup configuration without opening any database. */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readConfig } from "../config.ts";

test("source relocation does not change default storage", () => {
    const root = resolve("fixture-root");
    const config = readConfig(root, {});
    assert.equal(config.databasePath, resolve(root, "BackEnd/Persistence Layer/data/game.sqlite"));
    assert.equal(config.frontendPort, 3000);
    assert.equal(config.backendPort, 3001);
});

test("database overrides remain repository-relative or absolute", () => {
    const root = resolve("fixture-root");
    assert.equal(readConfig(root, { DATABASE_PATH: "temporary/game.sqlite" }).databasePath, resolve(root, "temporary/game.sqlite"));
    const absolute = resolve("temporary/game.sqlite");
    assert.equal(readConfig(root, { DATABASE_PATH: absolute }).databasePath, absolute);
});

test("configuration retains environment, port and secret validation", () => {
    const root = resolve("fixture-root");
    assert.throws(() => readConfig(root, { APP_ENV: "staging" }), /APP_ENV must be/);
    for (const name of ["FRONTEND_PORT", "BACKEND_PORT"]) {
        for (const value of ["0", "65536", "1.5", "invalid", ""]) {
            assert.throws(() => readConfig(root, { [name]: value }), /must be an integer/);
        }
    }
    assert.throws(() => readConfig(root, { APP_ENV: "production" }), /Set BETTER_AUTH_SECRET/);
    assert.throws(() => readConfig(root, { APP_ENV: "production", BETTER_AUTH_SECRET: " " }), /Set BETTER_AUTH_SECRET/);
});

test("wildcard connection hosts and auth URL overrides stay unchanged", () => {
    const root = resolve("fixture-root");
    assert.equal(readConfig(root, { BACKEND_HOST: "0.0.0.0" }).backendConnectHost, "127.0.0.1");
    assert.equal(readConfig(root, { BACKEND_HOST: "::", FRONTEND_HOST: "::1" }).baseURL, "http://[::1]:3000");
    assert.equal(readConfig(root, { BACKEND_HOST: "::" }).backendConnectHost, "::1");
    const config = readConfig(root, { APP_ENV: "production", BETTER_AUTH_SECRET: " test-secret ", BETTER_AUTH_URL: " https://game.example " });
    assert.equal(config.secret, "test-secret");
    assert.equal(config.baseURL, "https://game.example");
    assert.equal(config.production, true);
});
