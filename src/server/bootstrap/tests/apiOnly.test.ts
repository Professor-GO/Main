import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("API-only starts with the website port occupied and retains API security", { timeout: 15000 }, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "professor-api-only-"));
    const website = createServer().listen(0, "127.0.0.1");
    await once(website, "listening");
    const frontend = website.address();
    assert.ok(frontend && typeof frontend !== "string");
    const reservation = createServer().listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const backend = reservation.address();
    assert.ok(backend && typeof backend !== "string");
    await new Promise<void>((done) => reservation.close(() => done()));
    const child = spawn(process.execPath, ["src/server/bootstrap/server.ts", "--api-only"], {
        cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
        env: { ...process.env, APP_ENV: "test", FRONTEND_HOST: "127.0.0.1", FRONTEND_PORT: String(frontend.port), BACKEND_HOST: "127.0.0.1", BACKEND_PORT: String(backend.port), DATABASE_PATH: join(directory, "game.sqlite"), BETTER_AUTH_URL: "", BETTER_AUTH_SECRET: "api-only-test-secret-01234567890123456789", GEMINI_API_KEY: "" },
        stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    t.after(async () => {
        if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
        await new Promise<void>((done) => website.close(() => done()));
        await rm(directory, { recursive: true, force: true });
    });
    await new Promise<void>((done, reject) => {
        let output = "";
        const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 8000);
        child.stdout.on("data", (data: Buffer) => { output += data; if (output.includes("Press Ctrl+C")) { clearTimeout(timer); done(); } });
        child.stderr.on("data", (data: Buffer) => { output += data; });
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${output}`)); });
    });
    const origin = `http://127.0.0.1:${backend.port}`;
    const health = await fetch(origin + "/api/health");
    assert.equal(health.status, 200);
    const status = await health.json() as { database: string };
    assert.equal(status.database, "connected");
    assert.equal((await fetch(origin + "/api/auth/me")).status, 401);
    assert.equal((await fetch(origin + "/")).status, 404);
    assert.equal(health.headers.get("x-content-type-options"), "nosniff");
});
