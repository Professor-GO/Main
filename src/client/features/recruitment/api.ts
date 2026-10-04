import { ApiError, record, request } from "../../api/request";

export type Rarity = "Common" | "Rare" | "Epic" | "Legendary";
export type CageId = "golden-cage" | "iron-cage" | "bronze-cage";

const RARITIES: readonly Rarity[] = ["Legendary", "Epic", "Rare", "Common"];
const CAGE_IDS: readonly CageId[] = ["golden-cage", "iron-cage", "bronze-cage"];

/** A professor fresh out of the gashapon, as the recruit page shows them. */
export type RecruitedProfessor = {
  id: string;
  name: string;
  department: string;
  rarity: Rarity;
  cage: { id: CageId; name: string };
  stats: { health: number; attack: number; defense: number; speed: number };
  level: number;
  copies: number;
  copiesToLevelUp: number;
  isNew: boolean;
};

/**
 * Progress toward the guaranteed Epic or Legendary professor: `count` pulls in a row without
 * one, out of `guarantee`. The pull numbered `guarantee` is always Epic or Legendary.
 */
export type PityProgress = { count: number; guarantee: number };

/** Everything the recruit page needs before the first pull. */
export type Machine = {
  cost: number;
  pity: PityProgress;
  // The chance, from 0 to 1, of each rarity before pity.
  odds: Record<Rarity, number>;
};

const SOMETHING_WRONG = "Something went wrong. Please try again.";

/** Checks that a value is a whole number of at least `min`. */
function count(value: unknown, min = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

/**
 * Loads the pull cost, the player's pity, and the odds of each rarity.
 * @returns The machine's details.
 * @throws ApiError if the server cannot be reached or replies with something unexpected.
 */
export async function loadMachine(): Promise<Machine> {
  const [pityReply, poolReply] = await Promise.all([
    request("/api/gacha/pity").then(record),
    request("/api/gacha/pool").then(record),
  ]);
  const pity = record(pityReply.pity);
  if (
    !count(pityReply.cost, 1) ||
    !count(pityReply.guarantee, 1) ||
    !count(pity.epic) ||
    !Array.isArray(poolReply.professors)
  )
    throw new ApiError(SOMETHING_WRONG);
  const odds: Record<Rarity, number> = { Legendary: 0, Epic: 0, Rare: 0, Common: 0 };
  for (const entry of poolReply.professors) {
    const professor = record(entry);
    if (
      !RARITIES.includes(professor.rarity as Rarity) ||
      typeof professor.pullChance !== "number"
    )
      throw new ApiError(SOMETHING_WRONG);
    odds[professor.rarity as Rarity] += professor.pullChance;
  }
  return {
    cost: pityReply.cost,
    pity: { count: pity.epic, guarantee: pityReply.guarantee },
    odds,
  };
}

/**
 * Spends tokens on one pull.
 * @param guarantee - The size of the guarantee, from loadMachine(), to report progress against.
 * @returns The professor who came out, the player's new pity, and their token balance.
 * @throws ApiError with the server's message, such as when the player has too few tokens.
 */
export async function pullProfessor(guarantee: number): Promise<{
  professor: RecruitedProfessor;
  pity: PityProgress;
  tokens: number;
}> {
  const reply = record(await request("/api/gacha/pull", {}));
  const item = record(reply.item);
  const professor = record(item.professor);
  const cage = record(professor.cage);
  const stats = record(professor.stats);
  const pity = record(reply.pity);
  const user = record(reply.user);
  if (
    typeof professor.id !== "string" ||
    typeof professor.name !== "string" ||
    typeof professor.department !== "string" ||
    !RARITIES.includes(professor.rarity as Rarity) ||
    !CAGE_IDS.includes(cage.id as CageId) ||
    typeof cage.name !== "string" ||
    !count(stats.health) ||
    !count(stats.attack) ||
    !count(stats.defense) ||
    !count(stats.speed) ||
    !count(item.level, 1) ||
    !count(item.copies, 1) ||
    !count(professor.copiesToLevelUp, 1) ||
    typeof reply.isNew !== "boolean" ||
    !count(pity.epic) ||
    !count(user.tokens)
  )
    throw new ApiError(SOMETHING_WRONG);
  return {
    professor: {
      id: professor.id,
      name: professor.name,
      department: professor.department,
      rarity: professor.rarity as Rarity,
      cage: { id: cage.id as CageId, name: cage.name },
      stats: {
        health: stats.health,
        attack: stats.attack,
        defense: stats.defense,
        speed: stats.speed,
      },
      level: item.level,
      copies: item.copies,
      copiesToLevelUp: professor.copiesToLevelUp,
      isNew: reply.isNew,
    },
    pity: { count: pity.epic, guarantee },
    tokens: user.tokens,
  };
}
