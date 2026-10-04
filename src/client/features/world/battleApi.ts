import { ApiError, record, request } from "../../api/request";
import type { PublicQuestion } from "../questions/types";

export type BattleView = {
  id: string;
  professorId: string;
  professorName: string;
  // The professor the player sent out, or null (or missing) if the student fights.
  fighterId?: string | null;
  // True once the defeated professor has been caught in a cage.
  caught?: boolean;
  version: number;
  health: number;
  maxHealth: number;
  playerHealth: number;
  playerMaxHealth: number;
  status: "fighting" | "question" | "won" | "lost" | "fled";
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
  } | null;
};
export type BattleAction = {
  actionId: string;
  version: number;
  kind: "attack" | "answer" | "timeout" | "flee";
  questionId?: string;
  selectedIndex?: number;
};

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
    !["fighting", "question", "won", "lost", "fled"].includes(
      String(b.status),
    ) ||
    !integer(b.eventsTriggered) ||
    (b.eventNumber !== null && !integer(b.eventNumber))
  )
    throw new ApiError("Invalid battle response.");
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
      !integer(f.healingPercent)
    )
      throw new ApiError("Invalid battle result.");
  }
  return b as BattleView;
}

/**
 * Starts an encounter once, with a stable id for explicit retries.
 * @param fighterId - The professor the player sends out, or null to fight as the student.
 */
export async function startBattle(
  encounterId: string,
  professorId: string,
  fighterId: string | null = null,
): Promise<BattleView> {
  return parseBattle(
    await request("/api/battle/start", {
      encounterId,
      professorId,
      ...(fighterId ? { fighterId } : {}),
    }),
  );
}
/**
 * Throws a cage at a defeated professor to catch them.
 * @returns The battle afterwards, whether the professor is new to the player, how many copies
 * of them the player now has, and how many of that cage are left.
 */
export async function catchProfessor(
  id: string,
  cageId: string,
): Promise<{
  battle: BattleView;
  isNew: boolean;
  copies: number;
  cagesLeft: number;
}> {
  const reply = record(
    await request(`/api/battle/${encodeURIComponent(id)}/catch`, { cageId }),
  );
  const copies = record(reply.item).copies;
  if (
    typeof reply.isNew !== "boolean" ||
    !Number.isSafeInteger(copies) ||
    !Number.isSafeInteger(reply.cagesLeft)
  )
    throw new ApiError("Invalid catch result.");
  return {
    battle: parseBattle(reply.battle),
    isNew: reply.isNew,
    copies: copies as number,
    cagesLeft: reply.cagesLeft as number,
  };
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
