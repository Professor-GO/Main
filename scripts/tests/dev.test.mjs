/** Starts the real development launcher against disposable SQLite and checks its process lease. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";

async function port() {
  const listener = createServer();
  await new Promise((done) => listener.listen(0, "127.0.0.1", done));
  const value = listener.address().port;
  await new Promise((done) => listener.close(done));
  return value;
}
async function eventually(check) {
  let last;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await check();
      return;
    } catch (error) {
      last = error;
      await delay(100);
    }
  }
  throw last;
}
test(
  "dev proxy preserves origin, cookies, private paths, edge limit and cleans children",
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "professor-go-dev-"));
    const frontendPort = await port();
    const backendPort = await port();
    const origin = `http://127.0.0.1:${frontendPort}`;
    const backend = `http://127.0.0.1:${backendPort}`;
    const child = spawn(process.execPath, ["scripts/dev.mjs"], {
      cwd: resolve("."),
      stdio: "ignore",
      env: {
        ...process.env,
        APP_ENV: "test",
        FRONTEND_HOST: "127.0.0.1",
        BACKEND_HOST: "127.0.0.1",
        FRONTEND_PORT: String(frontendPort),
        BACKEND_PORT: String(backendPort),
        DATABASE_PATH: join(directory, "game.sqlite"),
        BETTER_AUTH_URL: origin,
        GEMINI_API_KEY: "",
      },
    });
    try {
      await eventually(async () =>
        assert.equal((await fetch(`${origin}/api/health`)).status, 200),
      );
      assert.match(await (await fetch(origin)).text(), /main.tsx/);
      const response = await fetch(`${origin}/api/auth/register`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          username: "DevPlayer",
          password: "test-password-42",
        }),
      });
      assert.equal(response.status, 201);
      const cookie = response.headers.get("set-cookie").split(";")[0];
      assert.equal(
        (await fetch(`${origin}/api/auth/me`, { headers: { cookie } })).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${origin}/api/auth/logout`, {
            method: "POST",
            headers: {
              origin: "http://evil.invalid",
              "content-type": "application/json",
              cookie,
            },
            body: "{}",
          })
        ).status,
        403,
      );
      const privateFile = await fetch(
        `${origin}/@fs/${resolve("package.json").replaceAll("\\", "/")}`,
      );
      assert.equal(privateFile.status, 403);
      for (let n = 0; n < 59; n++)
        await fetch(`${origin}/api/auth/login`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: "{}",
        });
      const limited = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get("retry-after"), "60");
    } finally {
      child.kill("SIGTERM");
      await eventually(async () => {
        await assert.rejects(
          fetch(origin, { signal: AbortSignal.timeout(300) }),
        );
        await assert.rejects(
          fetch(`${backend}/api/health`, { signal: AbortSignal.timeout(300) }),
        );
      });
      await rm(directory, { recursive: true, force: true });
    }
  },
);
