import { ApiError, record, request } from "../../api/request";
import type { WildProfessor } from "./Game Mechanics/game";

const INVALID = "Something went wrong. Please try again.";

/** A professor as the server describes them in the gacha pool, an inventory, or a pull. */
export type ProfessorInfo = { id: string; name: string; rarity: string };
/** One professor the player owns, with its level. */
export type OwnedProfessor = ProfessorInfo & { level: number };
/** One kind of cage the player owns, and how many of it they have. */
export type OwnedCage = { id: string; name: string; quantity: number };
/** What came out of one gacha pull. */
export type Pull =
  | {
      kind: "professor";
      professor: ProfessorInfo;
      isNew: boolean;
      copies: number;
    }
  | { kind: "cage"; cage: { id: string; name: string }; quantity: number };

/** Checks a professor in a server reply. */
function parseProfessor(value: unknown): ProfessorInfo {
  const professor = record(value);
  if (
    typeof professor.id !== "string" ||
    typeof professor.name !== "string" ||
    typeof professor.rarity !== "string"
  )
    throw new ApiError(INVALID);
  return { id: professor.id, name: professor.name, rarity: professor.rarity };
}

/** Checks a whole number of zero or more in a server reply. */
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new ApiError(INVALID);
  return value as number;
}

/**
 * Loads the wild professors who can appear on the campus map, from the public gacha pool:
 * the Rare and Epic ones. The server decides each professor's rarity, so the map always
 * matches the gacha.
 * @returns The wild professors, possibly none.
 * @throws ApiError if the server cannot be reached or replies with something unexpected.
 */
export async function loadWildProfessors(): Promise<WildProfessor[]> {
  const pool = record(await request("/api/gacha/pool"));
  if (!Array.isArray(pool.professors)) throw new ApiError(INVALID);
  return pool.professors.flatMap((entry: unknown) => {
    const professor = record(entry);
    return (professor.rarity === "Rare" || professor.rarity === "Epic") &&
      typeof professor.id === "string" &&
      typeof professor.name === "string" &&
      typeof professor.department === "string"
      ? [
          {
            id: professor.id,
            name: professor.name,
            department: professor.department,
            rarity: professor.rarity,
          },
        ]
      : [];
  });
}

/**
 * Loads the player's professors and cages.
 * @returns What they own.
 * @throws ApiError if the server cannot be reached or replies with something unexpected.
 */
export async function loadInventory(): Promise<{
  professors: OwnedProfessor[];
  cages: OwnedCage[];
}> {
  const reply = record(await request("/api/inventory"));
  if (!Array.isArray(reply.inventory) || !Array.isArray(reply.cages))
    throw new ApiError(INVALID);
  return {
    professors: reply.inventory.map((entry: unknown) => {
      const item = record(entry);
      return { ...parseProfessor(item.professor), level: count(item.level) };
    }),
    cages: reply.cages.map((entry: unknown) => {
      const owned = record(entry);
      const cage = record(owned.cage);
      if (typeof cage.id !== "string" || typeof cage.name !== "string")
        throw new ApiError(INVALID);
      return { id: cage.id, name: cage.name, quantity: count(owned.quantity) };
    }),
  };
}

/** Checks one pull in a server reply. */
function parsePull(value: unknown): Pull {
  const pull = record(value);
  if (pull.kind === "professor") {
    const item = record(pull.item);
    return {
      kind: "professor",
      professor: parseProfessor(item.professor),
      isNew: pull.isNew === true,
      copies: count(item.copies),
    };
  }
  const cage = record(pull.cage);
  if (
    pull.kind !== "cage" ||
    typeof cage.id !== "string" ||
    typeof cage.name !== "string"
  )
    throw new ApiError(INVALID);
  return {
    kind: "cage",
    cage: { id: cage.id, name: cage.name },
    quantity: count(pull.quantity),
  };
}

/**
 * Loads what the gashapon machine needs to show: the price of a pull and the player's tokens.
 * @returns The cost of one pull and the player's balance.
 * @throws ApiError if the server cannot be reached or replies with something unexpected.
 */
export async function loadGacha(): Promise<{ cost: number; tokens: number }> {
  const [pool, me] = await Promise.all([
    request("/api/gacha/pool"),
    request("/api/auth/me"),
  ]);
  return {
    cost: count(record(pool).cost),
    tokens: count(record(record(me).user).tokens),
  };
}

/**
 * Makes one pull or ten at the gashapon machine.
 * @param pulls - 1 or 10.
 * @returns What came out, in order, and the player's token balance afterwards.
 * @throws ApiError with status 409 if the player cannot afford it.
 */
export async function pullGacha(
  pulls: 1 | 10,
): Promise<{ pulls: Pull[]; tokens: number }> {
  const reply = record(
    await request("/api/gacha/pull", pulls === 10 ? { count: 10 } : {}),
  );
  const tokens = count(record(reply.user).tokens);
  if (pulls === 1) return { pulls: [parsePull(reply)], tokens };
  if (!Array.isArray(reply.pulls)) throw new ApiError(INVALID);
  return { pulls: reply.pulls.map(parsePull), tokens };
}
