import type { DatabaseSync } from "node:sqlite";
import type { CombatState } from "../Game Engine/encounterBattle.ts";
import { httpError } from "../../src/server/http/http.ts";
import type { CodingQuestion } from "../../src/server/modules/questions/infrastructure/gemini.ts";

export type Battle = {
  id: string;
  professorId: string;
  professorName: string;
  version: number;
  combat: CombatState;
  quiz: (CodingQuestion & { id: string; expiresAt: number }) | null;
  feedback: {
    correct: boolean;
    timedOut: boolean;
    answerIndex: number;
    explanation: string;
    healed: number;
    healingPercent: number;
    /** Absent on battle results persisted before the player-health penalty was added. */
    playerDamage?: number;
  } | null;
};

/** Adds battle storage without changing existing account, quiz, or inventory rows. */
export function initializeBattles(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS encounter_battles (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    state_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS encounter_actions (
    battle_id TEXT NOT NULL REFERENCES encounter_battles(id) ON DELETE CASCADE,
    action_id TEXT NOT NULL, command_json TEXT NOT NULL,
    PRIMARY KEY (battle_id, action_id)
  );`);
}

/** Reads only a battle belonging to the authenticated player. */
export function readBattle(
  db: DatabaseSync,
  userId: string,
  id: string,
): Battle {
  const row = db
    .prepare(
      "SELECT state_json FROM encounter_battles WHERE id = ? AND user_id = ?",
    )
    .get(id, userId) as { state_json: string } | undefined;
  if (!row) throw httpError(404, "Battle not found.");
  return JSON.parse(row.state_json) as Battle;
}

/** Saves a new encounter once; retrying the same encounter returns its existing state. */
export function saveBattle(
  db: DatabaseSync,
  userId: string,
  battle: Battle,
): Battle {
  db.prepare(
    "INSERT OR IGNORE INTO encounter_battles (id, user_id, state_json) VALUES (?, ?, ?)",
  ).run(battle.id, userId, JSON.stringify(battle));
  const saved = readBattle(db, userId, battle.id);
  if (saved.professorId !== battle.professorId)
    throw httpError(
      409,
      "This encounter already belongs to another professor.",
    );
  return saved;
}

/** Installs one generated question only if that event is still waiting for it. */
export function installQuiz(
  db: DatabaseSync,
  userId: string,
  battle: Battle,
  quiz: NonNullable<Battle["quiz"]>,
): Battle {
  const next = { ...battle, quiz };
  db.prepare(
    "UPDATE encounter_battles SET state_json = ? WHERE id = ? AND user_id = ? AND state_json = ?",
  ).run(JSON.stringify(next), battle.id, userId, JSON.stringify(battle));
  return readBattle(db, userId, battle.id);
}

/** Atomically records each command and combat change, making lost-response retries harmless. */
export function changeBattle(
  db: DatabaseSync,
  userId: string,
  id: string,
  actionId: string,
  version: number,
  command: object,
  change: (battle: Battle) => Battle,
): Battle {
  db.exec("BEGIN IMMEDIATE");
  try {
    const battle = readBattle(db, userId, id);
    const fingerprint = JSON.stringify(command);
    const prior = db
      .prepare(
        "SELECT command_json FROM encounter_actions WHERE battle_id = ? AND action_id = ?",
      )
      .get(id, actionId);
    if (prior) {
      if (prior.command_json !== fingerprint)
        throw httpError(409, "Retry the same battle action.");
      db.exec("COMMIT");
      return battle;
    }
    if (battle.version !== version)
      throw httpError(
        409,
        "The battle has changed. Refresh the battle and try again.",
      );
    const next = change(battle);
    next.version++;
    db.prepare(
      "UPDATE encounter_battles SET state_json = ? WHERE id = ? AND user_id = ?",
    ).run(JSON.stringify(next), id, userId);
    db.prepare(
      "INSERT INTO encounter_actions (battle_id, action_id, command_json) VALUES (?, ?, ?)",
    ).run(id, actionId, fingerprint);
    db.exec("COMMIT");
    return next;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

/** Publishes the summon roster and HP, hiding answers, checkpoint rolls and unfinished strikes. */
export function publicBattle(battle: Battle) {
  const { combat, quiz } = battle;
  const question =
    quiz && combat.status === "question"
      ? (() => {
          const { answerIndex, explanation, ...visible } = quiz;
          return visible;
        })()
      : null;
  return {
    id: battle.id,
    professorId: battle.professorId,
    professorName: battle.professorName,
    version: battle.version,
    health: combat.health,
    maxHealth: combat.maxHealth,
    playerHealth: combat.playerHealth,
    playerMaxHealth: combat.playerStats?.health ?? 100,
    activeProfessorId: combat.activeProfessorId ?? null,
    fighters: combat.fighters ?? null,
    status: combat.status,
    eventNumber: combat.pendingEvent === null ? null : combat.pendingEvent + 1,
    eventsTriggered: combat.eventsTriggered,
    question,
    feedback: battle.feedback,
  };
}
