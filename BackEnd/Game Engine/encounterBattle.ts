/** Server-owned combat rules for wild professor encounters. */
export const STUDENT_STATS = { health: 100, attack: 600, defense: 20 };

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
};

/** Chooses one checkpoint per requested range, once at the start of a fight. */
export function createCombat(
  stats: { health: number; attack: number; defense: number },
  random = Math.random,
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
    playerHealth: STUDENT_STATS.health,
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
      state.playerHealth - Math.floor(state.attack / STUDENT_STATS.defense),
    );
    state.status = state.playerHealth === 0 ? "lost" : "fighting";
  }
}

/** Deals floor(attack / defense) damage; the professor replies after all quiz interruptions. */
export function strike(state: CombatState): CombatState {
  if (state.status !== "fighting")
    throw new Error("Finish the current question before attacking.");
  const next = structuredClone(state);
  applyDamage(next, Math.floor(STUDENT_STATS.attack / state.defense));
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
