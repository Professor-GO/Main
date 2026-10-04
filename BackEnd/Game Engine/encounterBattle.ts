/** Server-owned combat rules for wild professor encounters. */
export const STUDENT_STATS = { health: 100, attack: 600, defense: 20 };
/** Each level above 1 adds this share to a sent-out professor's health and attack. */
export const LEVEL_BONUS = 0.1;

/** Whoever fights on the player's side: the student, or a professor they sent out. */
export type FighterStats = { health: number; attack: number; defense: number };

/**
 * Works out the battle stats of a professor the player sends out. Roster stats are on a
 * smaller scale than the student's, so attack is multiplied by 6 and defense divided by 3
 * to put them on the same footing; levels raise health and attack.
 */
export function professorFighter(
  stats: { health: number; attack: number; defense: number },
  level: number,
): FighterStats {
  const bonus = 1 + LEVEL_BONUS * (level - 1);
  return {
    health: Math.round(stats.health * bonus),
    attack: Math.round(stats.attack * 6 * bonus),
    defense: Math.max(1, Math.round(stats.defense / 3)),
  };
}

export type CombatState = {
  maxHealth: number;
  health: number;
  playerHealth: number;
  attack: number;
  defense: number;
  checkpoints: number[];
  eventsTriggered: number;
  pendingEvent: number | null;
  remainingDamage: number;
  status: "fighting" | "question" | "won" | "lost" | "fled";
  // The player's side. Battles saved before professors could be sent out have none, and
  // are fought by the student.
  fighter?: FighterStats;
};

/** Chooses one checkpoint per requested range, once at the start of a fight. */
export function createCombat(
  stats: { health: number; attack: number; defense: number },
  random = Math.random,
  fighter: FighterStats = STUDENT_STATS,
): CombatState {
  // Whole HP checkpoints stay inside each range even when max HP is not divisible by the fractions.
  const checkpoint = (lower: number, upper: number) => {
    const min = Math.ceil(stats.health * lower),
      max = Math.floor(stats.health * upper);
    return Math.max(1, min + Math.floor(random() * (max - min + 1)));
  };
  return {
    maxHealth: stats.health,
    health: stats.health,
    playerHealth: fighter.health,
    fighter,
    attack: stats.attack,
    defense: stats.defense,
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

/** Applies a strike, pausing at a crossed checkpoint so a lethal hit cannot skip a quiz. */
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
  if (state.health === 0) state.status = "won";
  else {
    state.playerHealth = Math.max(
      0,
      state.playerHealth -
        Math.floor(state.attack / (state.fighter ?? STUDENT_STATS).defense),
    );
    state.status = state.playerHealth === 0 ? "lost" : "fighting";
  }
}

/** Deals floor(attack / defense) damage; the professor replies after all quiz interruptions. */
export function strike(state: CombatState): CombatState {
  if (state.status !== "fighting")
    throw new Error("Finish the current question before attacking.");
  const next = structuredClone(state);
  applyDamage(
    next,
    Math.floor((state.fighter ?? STUDENT_STATS).attack / state.defense),
  );
  return next;
}

/** Heals floor(lost HP * random integer percentage from 50 to 80) on a wrong answer. */
export function resolveQuiz(
  state: CombatState,
  correct: boolean,
  random = Math.random,
): { state: CombatState; healed: number; healingPercent: number } {
  if (state.status !== "question")
    throw new Error("There is no question to answer.");
  const next = structuredClone(state);
  const healingPercent = correct ? 0 : 50 + Math.floor(random() * 31);
  const healed = Math.floor(
    ((next.maxHealth - next.health) * healingPercent) / 100,
  );
  next.health = Math.min(next.maxHealth, next.health + healed);
  next.pendingEvent = null;
  applyDamage(next, next.remainingDamage);
  return { state: next, healed, healingPercent };
}
