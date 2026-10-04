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
    professorId: "frank-wood",
  });
  assert.equal(reply.status, 200);
  assert.equal(
    (await call("battle/start", { encounterId: id, professorId: "frank-wood" }))
      .data.health,
    50,
  );
  assert.equal(
    (
      await call("battle/start", {
        encounterId: randomUUID(),
        professorId: "tor-aamodt",
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
    quiz.expiresAt > Date.now() && quiz.expiresAt <= Date.now() + 10_000,
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
  reply = await call(`battle/${id}/action`, {
    actionId: randomUUID(),
    version: expired.version,
    kind: "answer",
    questionId: expired.quiz!.id,
    selectedIndex: expired.quiz!.answerIndex,
  });
  assert.equal(reply.data.feedback?.correct, false);
  assert.equal(reply.data.feedback?.timedOut, true);
  const lostHp = expired.combat.maxHealth - expired.combat.health;
  assert.ok(
    reply.data.feedback!.healingPercent >= 50 &&
      reply.data.feedback!.healingPercent <= 80,
  );
  assert.equal(
    reply.data.feedback!.healed,
    Math.floor((lostHp * reply.data.feedback!.healingPercent) / 100),
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
  const health = reply.data.health;
  assert.equal((await call(`battle/${id}`)).data.health, health);
  while (reply.data.status === "fighting")
    reply = await call(`battle/${id}/action`, {
      actionId: randomUUID(),
      version: reply.data.version,
      kind: "attack",
    });
  assert.equal(reply.data.status, "won");
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
    professorId: "frank-wood",
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
  assert.equal(readBattle(db, account.user.id, anotherId).combat.health, 50);
  assert.equal(db.isTransaction, false);
});
