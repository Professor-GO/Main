/**
 * Server-owned combat rules for wild professor encounters. The fight itself runs in real time in
 * the browser; each landed punch arrives here as one strike, either the player's (strike) or the
 * professor's (enemyStrike), and these rules decide the damage.
 */
export const STUDENT_STATS = { health: 100, attack: 600, defense: 20 };

/** Wild professors appear at these levels. The campus map rolls them (SPAWNING in world.ts). */
export const WILD_LEVELS = { min: 10, max: 100 };
/**
 * The rarities of professor that roam the campus map and the school as wild professors. The map
 * loads the same ones (loadWildProfessors in src/client/features/world/api.ts).
 */
export const WILD_RARITIES: readonly string[] = ["Rare", "Epic"];
/**
 * For each level a fighter is above their opponent, their attack, defense, and speed grow by
 * this many percent: a level 30 professor against a level 10 fighter has 200% of their stats.
 */
export const LEVEL_BONUS_PERCENT = 5;
/** Enemy landed hits deal 20% more damage, before whole-HP rounding. */
const ENEMY_DAMAGE_PERCENT = 120;

export type SummonFighter = {
  id: string;
  name: string;
  level: number;
  stats: { health: number; attack: number; defense: number; speed: number };
  defeated: boolean;
};

export type CombatState = {
  maxHealth: number;
  health: number;
  playerHealth: number;
  /** Optional for battles saved before professor summoning was introduced. */
  playerStats?: SummonFighter["stats"];
  activeProfessorId?: string;
  fighters?: SummonFighter[];
  attack: number;
  defense: number;
  /** The wild professor's level. Optional for battles saved before levels were introduced. */
  level?: number;
  checkpoints: number[];
  eventsTriggered: number;
  pendingEvent: number | null;
  remainingDamage: number;
  status: "summoning" | "fighting" | "question" | "won" | "lost" | "fled";
};

/**
 * Chooses one checkpoint per requested range, once at the start of a fight. Without a level
 * (as in tests of the base damage rules) neither fighter gets a level bonus.
 */
export function createCombat(
  stats: { health: number; attack: number; defense: number },
  random = Math.random,
  level?: number,
): CombatState {
  if (
    level !== undefined &&
    (!Number.isInteger(level) ||
      level < WILD_LEVELS.min ||
      level > WILD_LEVELS.max)
  )
    throw new Error(
      `A wild professor's level must be a whole number from ${WILD_LEVELS.min} to ${WILD_LEVELS.max}.`,
    );
  // Whole HP checkpoints stay inside each range even when max HP is not divisible by the fractions.
  const checkpoint = (lower: number, upper: number) => {
    const min = Math.ceil(stats.health * lower),
      max = Math.floor(stats.health * upper);
    return Math.max(1, min + Math.floor(random() * (max - min + 1)));
  };
  return {
    maxHealth: stats.health,
    health: stats.health,
    playerHealth: STUDENT_STATS.health,
    attack: stats.attack,
    defense: stats.defense,
    ...(level === undefined ? {} : { level }),
    checkpoints: [
      checkpoint(2 / 3, 3 / 4),
      checkpoint(1 / 3, 3 / 5),
      Math.max(1, Math.floor(stats.health / 10)),
    ],
    eventsTriggered: 0,
    pendingEvent: null,
    remainingDamage: 0,
    status: "fighting",
  };
}

/** Takes an inventory snapshot; duplicate copies remain upgrades, rather than extra lives. */
export function prepareSummons(
  state: CombatState,
  fighters: SummonFighter[],
): CombatState {
  return {
    ...structuredClone(state),
    fighters: structuredClone(fighters),
    playerHealth: 0,
    status: "summoning",
  };
}

/** Starts or resumes combat with a fresh, undefeated member of the saved collection. */
export function summon(state: CombatState, professorId: string): CombatState {
  if (state.status !== "summoning")
    throw new Error(
      "Choose a professor only before fighting or after a knockout.",
    );
  const fighter = state.fighters?.find(
    (entry) => entry.id === professorId && !entry.defeated,
  );
  if (!fighter)
    throw new Error("Choose an available professor from your collection.");
  return {
    ...structuredClone(state),
    playerStats: { ...fighter.stats },
    activeProfessorId: fighter.id,
    playerHealth: fighter.stats.health,
    status: "fighting",
  };
}

/** Applies the player's strike, pausing at a crossed checkpoint so a lethal hit cannot skip a quiz. */
function applyDamage(state: CombatState, damage: number): void {
  const checkpoint = state.checkpoints[state.eventsTriggered];
  const checkpointHealth = checkpoint ?? -1;
  if (checkpoint !== undefined && state.health - damage <= checkpointHealth) {
    const applied = Math.max(0, state.health - checkpointHealth);
    state.health -= applied;
    state.remainingDamage = damage - applied;
    state.pendingEvent = state.eventsTriggered++;
    state.status = "question";
    return;
  }
  state.health = Math.max(0, state.health - damage);
  state.remainingDamage = 0;
  state.status = state.health === 0 ? "won" : "fighting";
}

/**
 * Works out how much a fighter's level lifts their attack, defense, and speed.
 * @param level - The fighter's level.
 * @param opponentLevel - Their opponent's level.
 * @returns A whole percentage: 100 at the same level or below, plus LEVEL_BONUS_PERCENT for each
 * level above the opponent.
 */
export function levelBonus(level: number, opponentLevel: number): number {
  return 100 + LEVEL_BONUS_PERCENT * Math.max(0, level - opponentLevel);
}

/**
 * Finds both fighters' levels: the wild professor's (null for a battle without levels), and the
 * summoned professor's. The student, with no professor summoned, counts as level 1.
 */
export function levelsOf(state: CombatState): {
  player: number;
  enemy: number | null;
} {
  const fighter = state.fighters?.find(
    (entry) => entry.id === state.activeProfessorId,
  );
  return { player: fighter?.level ?? 1, enemy: state.level ?? null };
}

/**
 * Both fighters' level bonuses as whole percentages (see levelBonus). Only the higher level gets
 * one, and a battle without levels gives neither side a bonus.
 */
export function levelBonuses(state: CombatState): { player: number; enemy: number } {
  const levels = levelsOf(state);
  if (levels.enemy === null) return { player: 100, enemy: 100 };
  return {
    player: levelBonus(levels.player, levels.enemy),
    enemy: levelBonus(levels.enemy, levels.player),
  };
}

/**
 * A landed hit deals floor(attack / defense), with a minimum of one damage. Each side's stat is
 * first scaled by that side's level bonus and any damage bonus, using whole percentages and
 * rounding down once at the end.
 */
function hitDamage(
  attack: number,
  attackBonus: number,
  defense: number,
  defenseBonus: number,
  damagePercent = 100,
): number {
  return Math.max(
    1,
    Math.floor(
      (attack * attackBonus * damagePercent) / (defense * defenseBonus * 100),
    ),
  );
}

/** The player's punch landed, using the summoned professor's stats and both level bonuses. */
export function strike(state: CombatState): CombatState {
  if (state.status !== "fighting")
    throw new Error("Finish the current question before attacking.");
  const next = structuredClone(state);
  const bonus = levelBonuses(state);
  applyDamage(
    next,
    hitDamage(
      state.playerStats?.attack ?? STUDENT_STATS.attack,
      bonus.player,
      state.defense,
      bonus.enemy,
    ),
  );
  return next;
}

/** The professor's punch landed; a knockout pauses for reserves or ends the encounter. */
export function enemyStrike(state: CombatState): CombatState {
  if (state.status !== "fighting")
    throw new Error("The professor can only strike during the fight.");
  const next = structuredClone(state);
  const bonus = levelBonuses(state);
  next.playerHealth = Math.max(
    0,
    next.playerHealth -
      hitDamage(
        next.attack,
        bonus.enemy,
        state.playerStats?.defense ?? STUDENT_STATS.defense,
        bonus.player,
        ENEMY_DAMAGE_PERCENT,
      ),
  );
  if (next.playerHealth === 0) {
    const fighter = next.fighters?.find(
      (entry) => entry.id === next.activeProfessorId,
    );
    if (fighter) fighter.defeated = true;
    next.status = next.fighters?.some((entry) => !entry.defeated)
      ? "summoning"
      : "lost";
  }
  return next;
}

/** Wrong answers heal the professor and remove floor(80% of current player HP) before combat resumes. */
export function resolveQuiz(
  state: CombatState,
  correct: boolean,
  random = Math.random,
): {
  state: CombatState;
  healed: number;
  healingPercent: number;
  playerDamage: number;
} {
  if (state.status !== "question")
    throw new Error("There is no question to answer.");
  const next = structuredClone(state);
  const healingPercent = correct ? 0 : 50 + Math.floor(random() * 31);
  const healed = Math.floor(
    ((next.maxHealth - next.health) * healingPercent) / 100,
  );
  next.health = Math.min(next.maxHealth, next.health + healed);
  const playerDamage = correct ? 0 : Math.floor((next.playerHealth * 80) / 100);
  next.playerHealth = Math.max(0, next.playerHealth - playerDamage);
  next.pendingEvent = null;
  applyDamage(next, next.remainingDamage);
  return { state: next, healed, healingPercent, playerDamage };
}
