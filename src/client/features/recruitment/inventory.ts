import { ApiError, record, request } from "../../api/request";
import type { Rarity } from "./api";

export type OwnedProfessor = {
  id: string;
  name: string;
  department: string;
  rarity: Rarity;
  level: number;
  copies: number;
  stats: { health: number; attack: number; defense: number; speed: number };
};

/** Reads the authenticated player's collection, with the roster details used on cards. */
export async function loadInventory(): Promise<OwnedProfessor[]> {
  const result = record(await request("/api/inventory"));
  if (!Array.isArray(result.inventory))
    throw new ApiError("Invalid professor collection.");
  const count = (value: unknown, min = 0): value is number =>
    Number.isSafeInteger(value) && (value as number) >= min;
  return result.inventory.map((entry: unknown) => {
    const item = record(entry),
      professor = record(item.professor),
      stats = record(professor.stats);
    if (
      typeof professor.id !== "string" ||
      typeof professor.name !== "string" ||
      typeof professor.department !== "string" ||
      !["Common", "Rare", "Epic", "Legendary"].includes(
        String(professor.rarity),
      ) ||
      !count(item.level, 1) ||
      !count(item.copies, 1) ||
      !count(stats.health, 1) ||
      !count(stats.attack) ||
      !count(stats.defense, 1) ||
      !count(stats.speed)
    )
      throw new ApiError("Invalid professor collection.");
    return {
      id: professor.id,
      name: professor.name,
      department: professor.department,
      rarity: professor.rarity as Rarity,
      level: item.level,
      copies: item.copies,
      stats: {
        health: stats.health,
        attack: stats.attack,
        defense: stats.defense,
        speed: stats.speed,
      },
    };
  });
}
