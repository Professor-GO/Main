import { ApiError, record, request } from "../../api/request";
import type { LegendaryProfessor } from "./Game Mechanics/game";

/**
 * Loads the Legendary professors who can appear on the campus map, from the public gacha pool.
 * The server decides each professor's rarity, so the map always matches the gacha.
 * @returns The Legendary professors, possibly none.
 * @throws ApiError if the server cannot be reached or replies with something unexpected.
 */
export async function loadLegendaries(): Promise<LegendaryProfessor[]> {
  const pool = record(await request("/api/gacha/pool"));
  if (!Array.isArray(pool.professors))
    throw new ApiError("Something went wrong. Please try again.");
  return pool.professors.flatMap((entry: unknown) => {
    const professor = record(entry);
    return professor.rarity === "Legendary" &&
      typeof professor.id === "string" &&
      typeof professor.name === "string" &&
      typeof professor.department === "string"
      ? [
          {
            id: professor.id,
            name: professor.name,
            department: professor.department,
          },
        ]
      : [];
  });
}
