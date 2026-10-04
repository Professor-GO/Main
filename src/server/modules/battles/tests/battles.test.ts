import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../../../storage/database.ts";
import { createAuth } from "../../accounts/infrastructure/betterAuth.ts";
import { createBackendApp } from "../../../http/apiApp.ts";
import {
  readBattle,
  publicBattle,
  changeBattle,
} from "../../../../../BackEnd/Persistence Layer/encounterBattles.ts";

test("encounter API binds questions to fights, enforces timeouts and retries, and never awards tokens", async (t) => {
  const db = openDatabase(":memory:");
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const auth = await createAuth(db, {
    baseURL: origin,
    secret: "battle-test-secret-that-is-long-enough",
    production: false,
  });
  await auth.$context;
  server.on("request", createBackendApp({ db, auth, environment: "test" }));
  t.after(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    db.close();
  });
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "";
  t.after(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });

  const signup = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "BattlePlayer",
      password: "test-password-123",
    }),
  });
  assert.equal(signup.status, 201);
  const cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const account = (await signup.json()) as { user: { id: string } };
  const call = async (path: string, body?: object) => {
    const response = await fetch(`${origin}/api/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: cookie,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      data: (await response.json()) as ReturnType<typeof publicBattle> & {
        message?: string;
      },
    };
  };
  const id = randomUUID();
  let reply = await call("battle/start", {
    encounterId: id,
    professorId: "tor-aamodt",
  });
  assert.equal(reply.status, 200);
  assert.equal(
    (await call("battle/start", { encounterId: id, professorId: "tor-aamodt" }))
      .data.health,
    57,
  );
  assert.equal(
    (
      await call("battle/start", {
        encounterId: randomUUID(),
        professorId: "frank-wood",
      })
    ).status,
    400,
  );
  assert.equal((await fetch(`${origin}/api/battle/${id}`)).status, 401);
  assert.throws(() => readBattle(db, "other-player", id), /Battle not found/);
  assert.equal(
    (
      await call(`battle/${id}/action`, {
        actionId: randomUUID(),
        version: 0,
        kind: "timeout",
      })
    ).status,
    409,
  );

  while (reply.data.status === "fighting") {
    const command = {
      actionId: randomUUID(),
      version: reply.data.version,
      kind: "attack",
    };
    reply = await call(`battle/${id}/action`, command);
    assert.equal(reply.status, 200);
    assert.deepEqual(
      (await call(`battle/${id}/action`, command)).data,
      reply.data,
    );
  }
  assert.equal(reply.data.eventNumber, 1);
  assert.equal(
    (
      await call(`battle/${id}/action`, {
        actionId: randomUUID(),
        version: reply.data.version,
        kind: "attack",
      })
    ).status,
    409,
  );
  const [first, repeated] = await Promise.all([
    call(`battle/${id}/question`),
    call(`battle/${id}/question`),
  ]);
  assert.equal(first.data.question?.id, repeated.data.question?.id);
  assert.equal("answerIndex" in first.data.question!, false);
  assert.equal("explanation" in first.data.question!, false);
  const quiz = readBattle(db, account.user.id, id).quiz!;
  assert.ok(
    quiz.expiresAt > Date.now() && quiz.expiresAt <= Date.now() + 30_000,
  );
  const answer = {
    actionId: randomUUID(),
    version: first.data.version,
    kind: "answer",
    questionId: quiz.id,
    selectedIndex: quiz.answerIndex,
  };
  reply = await call(`battle/${id}/action`, answer);
  assert.equal(reply.data.feedback?.correct, true);
  assert.equal(reply.data.feedback?.healed, 0);
  assert.equal(reply.data.feedback?.playerDamage, 0);
  assert.deepEqual(
    (await call(`battle/${id}/action`, answer)).data,
    reply.data,
  );
  assert.equal(
    (
      await call(`battle/${id}/action`, {
        ...answer,
        selectedIndex: (quiz.answerIndex + 1) % 4,
      })
    ).status,
    409,
  );
  while (reply.data.status === "fighting")
    reply = await call(`battle/${id}/action`, {
      actionId: randomUUID(),
      version: reply.data.version,
      kind: "attack",
    });
  await call(`battle/${id}/question`);
  const expired = readBattle(db, account.user.id, id);
  expired.quiz!.expiresAt = Date.now() - 1;
  db.prepare("UPDATE encounter_battles SET state_json = ? WHERE id = ?").run(
    JSON.stringify(expired),
    id,
  );
  const lateAnswer = {
    actionId: randomUUID(),
    version: expired.version,
    kind: "answer",
    questionId: expired.quiz!.id,
    selectedIndex: expired.quiz!.answerIndex,
  };
  reply = await call(`battle/${id}/action`, lateAnswer);
  assert.equal(reply.data.feedback?.correct, false);
  assert.equal(reply.data.feedback?.timedOut, true);
  const minDamage = Math.min(Math.floor((expired.combat.playerHealth * 5) / 100), 15);
  const maxDamage = Math.min(Math.floor((expired.combat.playerHealth * 12) / 100), 15);
  assert.ok(
    reply.data.feedback!.playerDamage >= minDamage &&
      reply.data.feedback!.playerDamage <= maxDamage,
  );
  assert.equal(
    reply.data.playerHealth,
    Math.max(
      0,
      expired.combat.playerHealth -
        reply.data.feedback!.playerDamage -
        (reply.data.status === "question" || reply.data.status === "won"
          ? 0
          : Math.floor(expired.combat.attack / 20)),
    ),
  );
  assert.deepEqual(
    (await call(`battle/${id}/action`, lateAnswer)).data,
    reply.data,
  );
  const lostHp = expired.combat.maxHealth - expired.combat.health;
  assert.ok(
    reply.data.feedback!.healingPercent >= 10 &&
      reply.data.feedback!.healingPercent <= 20,
  );
  assert.equal(
    reply.data.feedback!.healed,
    Math.floor((expired.combat.maxHealth * reply.data.feedback!.healingPercent) / 100),
  );

  while (reply.data.status === "fighting")
    reply = await call(`battle/${id}/action`, {
      actionId: randomUUID(),
      version: reply.data.version,
      kind: "attack",
    });
  await call(`battle/${id}/question`);
  const final = readBattle(db, account.user.id, id);
  final.quiz!.expiresAt = 0;
  db.prepare("UPDATE encounter_battles SET state_json = ? WHERE id = ?").run(
    JSON.stringify(final),
    id,
  );
  reply = await call(`battle/${id}`);
  assert.equal(reply.data.feedback?.timedOut, true);
  assert.equal(reply.data.eventsTriggered, 3);
  const minFinalDamage = Math.min(
    Math.floor((final.combat.playerHealth * 5) / 100),
    15,
  );
  const maxFinalDamage = Math.min(
    Math.floor((final.combat.playerHealth * 12) / 100),
    15,
  );
  assert.ok(
    reply.data.feedback!.playerDamage >= minFinalDamage &&
      reply.data.feedback!.playerDamage <= maxFinalDamage,
  );
  const health = reply.data.health;
  const playerHealth = reply.data.playerHealth;
  const reconciled = (await call(`battle/${id}`)).data;
  assert.equal(reconciled.health, health);
  assert.equal(reconciled.playerHealth, playerHealth);
  while (reply.data.status === "fighting")
    reply = await call(`battle/${id}/action`, {
      actionId: randomUUID(),
      version: reply.data.version,
      kind: "attack",
    });
  assert.ok(["won", "lost"].includes(reply.data.status));
  assert.equal(
    db.prepare('SELECT tokens FROM "user" WHERE id = ?').get(account.user.id)
      ?.tokens,
    50,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM question_attempts").get()?.count,
    0,
  );

  // A storage failure rolls back both HP and the idempotency receipt.
  const anotherId = randomUUID();
  await call("battle/start", {
    encounterId: anotherId,
    professorId: "tor-aamodt",
  });
  db.exec(
    "CREATE TRIGGER fail_battle_receipt BEFORE INSERT ON encounter_actions BEGIN SELECT RAISE(ABORT, 'test write failure'); END;",
  );
  assert.throws(
    () =>
      changeBattle(
        db,
        account.user.id,
        anotherId,
        randomUUID(),
        0,
        { kind: "attack" },
        (battle) => ({ ...battle, combat: { ...battle.combat, health: 1 } }),
      ),
    /test write failure/,
  );
  assert.equal(readBattle(db, account.user.id, anotherId).combat.health, 57);
  assert.equal(db.isTransaction, false);
});

test("players send out a professor they own, and catch a defeated professor with a cage", async (t) => {
  const db = openDatabase(":memory:");
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const auth = await createAuth(db, {
    baseURL: origin,
    secret: "battle-test-secret-that-is-long-enough",
    production: false,
  });
  await auth.$context;
  server.on("request", createBackendApp({ db, auth, environment: "test" }));
  t.after(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    db.close();
  });
  const signup = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "Catcher", password: "test-password-123" }),
  });
  const cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const userId = ((await signup.json()) as { user: { id: string } }).user.id;
  const call = async (path: string, body: object) => {
    const response = await fetch(`${origin}/api/${path}`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      data: (await response.json()) as {
        message?: string;
        fighterId?: string;
        playerMaxHealth?: number;
        caught?: boolean;
        battle: { caught: boolean };
        item: { copies: number; professor: { id: string } };
        isNew: boolean;
        cagesLeft: number;
      },
    };
  };

  // A professor the player does not own cannot be sent out.
  assert.equal(
    (
      await call("battle/start", {
        encounterId: randomUUID(),
        professorId: "tor-aamodt",
        fighterId: "guy-lumieux",
      })
    ).status,
    404,
  );
  // Guy Lumieux at level 2: health 200 and attack 183 from the roster, each 10% higher.
  db.prepare(
    "INSERT INTO inventory (user_id, professor_id, level) VALUES (?, 'guy-lumieux', 2)",
  ).run(userId);
  const id = randomUUID();
  const started = await call("battle/start", {
    encounterId: id,
    professorId: "tor-aamodt",
    fighterId: "guy-lumieux",
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.fighterId, "guy-lumieux");
  assert.equal(started.data.playerMaxHealth, 220);
  assert.equal(started.data.caught, false);

  // Catching needs a won battle and a cage the player owns.
  assert.equal(
    (await call(`battle/${id}/catch`, { cageId: "bronze-cage" })).status,
    409,
  );
  const battle = readBattle(db, userId, id);
  db.prepare("UPDATE encounter_battles SET state_json = ? WHERE id = ?").run(
    JSON.stringify({ ...battle, combat: { ...battle.combat, health: 0, status: "won" } }),
    id,
  );
  assert.equal(
    (await call(`battle/${id}/catch`, { cageId: "no-such-cage" })).status,
    400,
  );
  const noCage = await call(`battle/${id}/catch`, { cageId: "bronze-cage" });
  assert.equal(noCage.status, 409);
  assert.equal(noCage.data.message, "You don't have that cage.");

  db.prepare(
    "INSERT INTO items (user_id, item_id, quantity) VALUES (?, 'bronze-cage', 2)",
  ).run(userId);
  const caught = await call(`battle/${id}/catch`, { cageId: "bronze-cage" });
  assert.equal(caught.status, 200);
  assert.equal(caught.data.battle.caught, true);
  assert.equal(caught.data.item.professor.id, "tor-aamodt");
  assert.deepEqual(
    [caught.data.isNew, caught.data.item.copies, caught.data.cagesLeft],
    [true, 1, 1],
  );
  // A professor is caught only once per battle, and only one cage is spent.
  assert.equal(
    (await call(`battle/${id}/catch`, { cageId: "bronze-cage" })).status,
    409,
  );
  const cages = db
    .prepare("SELECT quantity FROM items WHERE user_id = ? AND item_id = 'bronze-cage'")
    .get(userId) as { quantity: number };
  assert.equal(cages.quantity, 1);
});

test("ten pulls are made together, and only when the player can afford all ten", async (t) => {
  const db = openDatabase(":memory:");
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const auth = await createAuth(db, {
    baseURL: origin,
    secret: "battle-test-secret-that-is-long-enough",
    production: false,
  });
  await auth.$context;
  server.on("request", createBackendApp({ db, auth, environment: "test" }));
  t.after(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    db.close();
  });
  const signup = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "TenPuller", password: "test-password-123" }),
  });
  const cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const userId = ((await signup.json()) as { user: { id: string } }).user.id;
  const pullTen = async () => {
    const response = await fetch(`${origin}/api/gacha/pull`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ count: 10 }),
    });
    return {
      status: response.status,
      data: (await response.json()) as {
        message?: string;
        pulls: { kind: string }[];
        user: { tokens: number };
      },
    };
  };

  // New accounts start with 50 tokens, which is not enough for ten pulls at 10 each.
  const short = await pullTen();
  assert.equal(short.status, 409);
  assert.equal(short.data.message, "You need 100 tokens for 10 pulls.");
  assert.equal(
    (db.prepare('SELECT tokens FROM "user" WHERE id = ?').get(userId) as { tokens: number }).tokens,
    50,
  );

  db.prepare('UPDATE "user" SET tokens = 105 WHERE id = ?').run(userId);
  const pulled = await pullTen();
  assert.equal(pulled.status, 200);
  assert.equal(pulled.data.pulls.length, 10);
  assert.equal(pulled.data.user.tokens, 5);
  // The tenth pull in a row without an Epic professor is always an Epic or better.
  assert.ok(
    pulled.data.pulls.some((pull) => pull.kind === "professor"),
  );
});
