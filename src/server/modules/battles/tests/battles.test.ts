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
} from "../infrastructure/sqliteEncounterBattles.ts";

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
  db.prepare("INSERT INTO inventory (user_id, professor_id) VALUES (?, ?)").run(
    account.user.id,
    "tor-aamodt",
  );
  db.prepare(
    "INSERT INTO inventory (user_id, professor_id, copies) VALUES (?, ?, ?)",
  ).run(account.user.id, "chao-liu", 4);
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
    level: 10,
    encounterId: id,
    professorId: "craig-scratchley",
  });
  assert.equal(reply.status, 200);
  assert.equal(reply.data.status, "summoning");
  // The professor keeps the level they rolled on the map; the summoned fighter's level is 1 until
  // they are levelled up, so the professor's stats get 100% + 5% x 9 levels.
  assert.equal(reply.data.level, 10);
  for (const level of [9, 101, 10.5, "50", undefined])
    assert.equal(
      (
        await call("battle/start", {
          encounterId: randomUUID(),
          professorId: "craig-scratchley",
          level,
        })
      ).status,
      400,
      `level ${String(level)}`,
    );
  assert.equal(reply.data.playerHealth, 0);
  assert.equal(reply.data.fighters?.length, 2);
  assert.equal(
    (
      await call(`battle/${id}/action`, {
        actionId: randomUUID(),
        version: 0,
        kind: "attack",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(`battle/${id}/action`, {
        actionId: randomUUID(),
        version: 0,
        kind: "summon",
        professorId: "frank-wood",
      })
    ).status,
    409,
  );
  const summonCommand = {
    actionId: randomUUID(),
    version: 0,
    kind: "summon",
    professorId: "tor-aamodt",
  };
  reply = await call(`battle/${id}/action`, summonCommand);
  assert.equal(reply.status, 200);
  assert.equal(reply.data.status, "fighting");
  assert.equal(reply.data.activeProfessorId, "tor-aamodt");
  assert.equal(reply.data.playerHealth, 57);
  assert.equal(reply.data.playerLevel, 1);
  assert.deepEqual(reply.data.levelBonus, { player: 100, enemy: 145 });
  assert.deepEqual(
    (await call(`battle/${id}/action`, summonCommand)).data,
    reply.data,
  );
  assert.equal(
    (
      await call(`battle/${id}/action`, {
        ...summonCommand,
        professorId: "chao-liu",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(`battle/${id}/action`, {
        actionId: randomUUID(),
        version: reply.data.version,
        kind: "summon",
        professorId: "chao-liu",
      })
    ).status,
    409,
  );
  assert.equal(
    (await call("battle/start", {
        encounterId: id,
        professorId: "craig-scratchley",
        level: 10,
      }))
      .data.health,
    62,
  );
  assert.equal(
    (
      await call("battle/start", {
        level: 10,
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
        version: reply.data.version,
        kind: "timeout",
      })
    ).status,
    409,
  );

  // The professor's punch lands: only the player loses health, and a retry does not repeat it.
  const punch = {
    actionId: randomUUID(),
    version: reply.data.version,
    kind: "enemyAttack",
  };
  const punched = await call(`battle/${id}/action`, punch);
  assert.equal(punched.status, 200);
  assert.equal(punched.data.playerHealth, 56);
  assert.equal(punched.data.health, reply.data.health);
  assert.equal(punched.data.version, reply.data.version + 1);
  assert.deepEqual(
    (await call(`battle/${id}/action`, punch)).data,
    punched.data,
  );
  reply = punched;

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
  // The fight is paused for the question, so the professor cannot land a punch either.
  assert.equal(
    (
      await call(`battle/${id}/action`, {
        actionId: randomUUID(),
        version: reply.data.version,
        kind: "enemyAttack",
      })
    ).status,
    409,
  );
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
  const quizDamage = Math.floor((expired.combat.playerHealth * 80) / 100);
  assert.equal(reply.data.feedback?.playerDamage, quizDamage);
  assert.equal(
    reply.data.playerHealth,
    expired.combat.playerHealth - quizDamage,
  );
  assert.deepEqual(
    (await call(`battle/${id}/action`, lateAnswer)).data,
    reply.data,
  );
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
  assert.equal(
    reply.data.feedback?.playerDamage,
    Math.floor((final.combat.playerHealth * 80) / 100),
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
    level: 10,
    encounterId: anotherId,
    professorId: "craig-scratchley",
  });
  // A knocked-out fighter stays unavailable after a persisted read. A reserve resumes
  // the same opponent/checkpoints, and duplicate copies do not add extra fighters.
  let reserves = await call(`battle/${anotherId}/action`, {
    actionId: randomUUID(),
    version: 0,
    kind: "summon",
    professorId: "tor-aamodt",
  });
  const low = readBattle(db, account.user.id, anotherId);
  low.combat.playerHealth = 1;
  low.combat.health = 30;
  low.combat.eventsTriggered = 1;
  db.prepare("UPDATE encounter_battles SET state_json = ? WHERE id = ?").run(
    JSON.stringify(low),
    anotherId,
  );
  const knockout = {
    actionId: randomUUID(),
    version: reserves.data.version,
    kind: "enemyAttack",
  };
  reserves = await call(`battle/${anotherId}/action`, knockout);
  assert.equal(reserves.data.status, "summoning");
  assert.equal(
    reserves.data.fighters?.find((fighter) => fighter.id === "tor-aamodt")
      ?.defeated,
    true,
  );
  assert.deepEqual(
    (await call(`battle/${anotherId}/action`, knockout)).data,
    reserves.data,
  );
  assert.equal(
    (
      await call(`battle/${anotherId}/action`, {
        actionId: randomUUID(),
        version: reserves.data.version,
        kind: "summon",
        professorId: "tor-aamodt",
      })
    ).status,
    409,
  );
  reserves = await call(`battle/${anotherId}/action`, {
    actionId: randomUUID(),
    version: reserves.data.version,
    kind: "summon",
    professorId: "chao-liu",
  });
  assert.equal(reserves.data.playerHealth, 48);
  assert.equal(reserves.data.health, 30);
  assert.equal(reserves.data.eventsTriggered, 1);
  assert.equal(reserves.data.activeProfessorId, "chao-liu");
  const last = readBattle(db, account.user.id, anotherId);
  last.combat.playerHealth = 1;
  db.prepare("UPDATE encounter_battles SET state_json = ? WHERE id = ?").run(
    JSON.stringify(last),
    anotherId,
  );
  reserves = await call(`battle/${anotherId}/action`, {
    actionId: randomUUID(),
    version: reserves.data.version,
    kind: "enemyAttack",
  });
  assert.equal(reserves.data.status, "lost");
  assert.ok(reserves.data.fighters?.every((fighter) => fighter.defeated));
  const rollbackId = randomUUID();
  await call("battle/start", {
    level: 10,
    encounterId: rollbackId,
    professorId: "craig-scratchley",
  });
  db.exec(
    "CREATE TRIGGER fail_battle_receipt BEFORE INSERT ON encounter_actions BEGIN SELECT RAISE(ABORT, 'test write failure'); END;",
  );
  assert.throws(
    () =>
      changeBattle(
        db,
        account.user.id,
        rollbackId,
        randomUUID(),
        0,
        { kind: "attack" },
        (battle) => ({ ...battle, combat: { ...battle.combat, health: 1 } }),
      ),
    /test write failure/,
  );
  assert.equal(readBattle(db, account.user.id, rollbackId).combat.health, 62);
  assert.equal(db.isTransaction, false);
});
