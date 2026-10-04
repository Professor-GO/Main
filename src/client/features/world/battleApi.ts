import { ApiError, record, request } from "../../api/request";
import type { PublicQuestion } from "../questions/types";

export type BattleView = {
  id: string;
  professorId: string;
  professorName: string;
  version: number;
  health: number;
  maxHealth: number;
  playerHealth: number;
  playerMaxHealth: number;
  status: "summoning" | "fighting" | "question" | "won" | "lost" | "fled";
  activeProfessorId?: string | null;
  fighters?: SummonFighter[] | null;
  /** The wild professor's level; null for a battle saved before levels. */
  level?: number | null;
  /** The summoned fighter's level (1 for the student). */
  playerLevel?: number;
  /**
   * How much each fighter's level lifts their attack, defense, and speed, as a whole percentage:
   * 100 is no bonus, and only the higher-level fighter gets one.
   */
  levelBonus?: { player: number; enemy: number };
  eventNumber: number | null;
  eventsTriggered: number;
  question: (PublicQuestion & { expiresAt: number }) | null;
  feedback: {
    correct: boolean;
    timedOut: boolean;
    answerIndex: number;
    explanation: string;
    healed: number;
    healingPercent: number;
    /** Older persisted results may omit the quiz's player-health penalty. */
    playerDamage?: number;
  } | null;
};
export type BattleAction = {
  actionId: string;
  version: number;
  // "attack" is the player's punch landing, "enemyAttack" the professor's.
  kind: "summon" | "attack" | "enemyAttack" | "answer" | "timeout" | "flee";
  professorId?: string;
  questionId?: string;
  selectedIndex?: number;
};

export type OwnedFighter = { id: string; name: string; level: number };
export type SummonFighter = OwnedFighter & {
  stats: { health: number; attack: number; defense: number; speed: number };
  defeated: boolean;
};

/** Lists only professors actually owned by this account for the fighter selector. */
export async function loadOwnedFighters(): Promise<OwnedFighter[]> {
  const result = record(await request("/api/inventory"));
  if (!Array.isArray(result.inventory))
    throw new ApiError("Invalid professor collection.");
  return result.inventory.map((entry: unknown) => {
    const item = record(entry),
      professor = record(item.professor);
    if (
      typeof professor.id !== "string" ||
      typeof professor.name !== "string" ||
      !Number.isSafeInteger(item.level) ||
      (item.level as number) < 1
    )
      throw new ApiError("Invalid professor collection.");
    return {
      id: professor.id,
      name: professor.name,
      level: item.level as number,
    };
  });
}

/** Checks server replies before rendering HP, generated text or the countdown. */
function parseBattle(value: unknown): BattleView {
  const b = record(value);
  const integer = (value: unknown) =>
    Number.isSafeInteger(value) && (value as number) >= 0;
  if (
    typeof b.id !== "string" ||
    typeof b.professorId !== "string" ||
    typeof b.professorName !== "string" ||
    !integer(b.version) ||
    !integer(b.health) ||
    !integer(b.maxHealth) ||
    !b.maxHealth ||
    !integer(b.playerHealth) ||
    !integer(b.playerMaxHealth) ||
    !b.playerMaxHealth ||
    !["summoning", "fighting", "question", "won", "lost", "fled"].includes(
      String(b.status),
    ) ||
    !integer(b.eventsTriggered) ||
    (b.eventNumber !== null && !integer(b.eventNumber))
  )
    throw new ApiError("Invalid battle response.");
  if (
    b.activeProfessorId !== undefined &&
    b.activeProfessorId !== null &&
    typeof b.activeProfessorId !== "string"
  )
    throw new ApiError("Invalid summoned professor.");
  // Levels and level bonuses set running speeds, so they must be real whole numbers.
  if (
    (b.level !== undefined && b.level !== null && !integer(b.level)) ||
    (b.playerLevel !== undefined && !integer(b.playerLevel))
  )
    throw new ApiError("Invalid battle levels.");
  if (b.levelBonus !== undefined) {
    const bonus = record(b.levelBonus);
    if (
      !integer(bonus.player) ||
      (bonus.player as number) < 100 ||
      !integer(bonus.enemy) ||
      (bonus.enemy as number) < 100
    )
      throw new ApiError("Invalid battle levels.");
  }
  if (b.fighters !== undefined && b.fighters !== null) {
    if (!Array.isArray(b.fighters))
      throw new ApiError("Invalid battle collection.");
    for (const value of b.fighters) {
      const fighter = record(value),
        stats = record(fighter.stats);
      if (
        typeof fighter.id !== "string" ||
        typeof fighter.name !== "string" ||
        !integer(fighter.level) ||
        !fighter.level ||
        typeof fighter.defeated !== "boolean" ||
        !integer(stats.health) ||
        !stats.health ||
        !integer(stats.attack) ||
        !integer(stats.defense) ||
        !stats.defense ||
        !integer(stats.speed)
      )
        throw new ApiError("Invalid battle collection.");
    }
  }
  if (b.question !== null) {
    const q = record(b.question);
    if (
      typeof q.id !== "string" ||
      typeof q.question !== "string" ||
      typeof q.topic !== "string" ||
      typeof q.difficulty !== "string" ||
      !["gemini", "fallback"].includes(String(q.source)) ||
      !integer(q.expiresAt) ||
      !Array.isArray(q.choices) ||
      q.choices.length !== 4 ||
      !q.choices.every((choice) => typeof choice === "string")
    )
      throw new ApiError("Invalid battle question.");
  }
  if (b.feedback !== null) {
    const f = record(b.feedback);
    if (
      typeof f.correct !== "boolean" ||
      typeof f.timedOut !== "boolean" ||
      !integer(f.answerIndex) ||
      (f.answerIndex as number) > 3 ||
      typeof f.explanation !== "string" ||
      !integer(f.healed) ||
      !integer(f.healingPercent) ||
      (f.playerDamage !== undefined && !integer(f.playerDamage))
    )
      throw new ApiError("Invalid battle result.");
  }
  return b as BattleView;
}

/** Starts an encounter once, with a stable id for explicit retries. */
export async function startBattle(
  encounterId: string,
  professorId: string,
  level: number,
): Promise<BattleView> {
  return parseBattle(
    await request("/api/battle/start", { encounterId, professorId, level }),
  );
}
/** Loads authoritative battle state after a conflict or a lost reply. */
export async function loadBattle(id: string): Promise<BattleView> {
  return parseBattle(await request(`/api/battle/${encodeURIComponent(id)}`));
}
/** Waits for Gemini before starting the server's question deadline. */
export async function loadBattleQuestion(id: string): Promise<BattleView> {
  return parseBattle(
    await request(
      `/api/battle/${encodeURIComponent(id)}/question`,
      undefined,
      40_000,
    ),
  );
}
/** Sends a command whose id is retained for same-command retries. */
export async function battleAction(
  id: string,
  action: BattleAction,
): Promise<BattleView> {
  return parseBattle(
    await request(`/api/battle/${encodeURIComponent(id)}/action`, action),
  );
}
