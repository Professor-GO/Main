/** Pure browser-compatible decisions; the arena owns physics, punch timing and validated hits. */
export type AiFighter = {
  x: number;
  /** Height above ground, positive upward. */
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  facing: -1 | 1;
  punch: "none" | "windup" | "strike" | "recover";
  hurt: boolean;
  hp: number;
  maxHp: number;
};

export type EnemyAiObservation = {
  dtMs: number;
  self: AiFighter;
  player: AiFighter;
  arena: { minX: number; maxX: number };
  reach: number;
};

export type EnemyAiCommand = {
  move: -1 | 0 | 1;
  jump: boolean;
  attack: boolean;
};

export type EnemyAiState = {
  mode: "chase" | "retreat" | "dodge";
  remainingMs: number;
  attackCooldownMs: number;
  dodgeCooldownMs: number;
  retreatCooldownMs: number;
  attackIntervalMs: number;
};

/** Creates a fresh brain; faster professors attack more often, with a minimum one-second interval. */
export function createEnemyAi(stats?: {
  health: number;
  attack: number;
  defense: number;
  speed: number;
}): EnemyAiState {
  return {
    mode: "chase",
    remainingMs: 0,
    attackCooldownMs: 0,
    dodgeCooldownMs: 0,
    retreatCooldownMs: 0,
    attackIntervalMs: Math.max(1000, 1400 - Math.max(0, stats?.speed ?? 0) * 2),
  };
}

/** Advances one tick without mutating inputs. The caller must stop ticking during quizzes and network pauses. */
export function stepEnemyAi(
  state: EnemyAiState,
  observation: EnemyAiObservation,
  random: () => number = Math.random,
): { state: EnemyAiState; command: EnemyAiCommand } {
  const { self, player, arena, reach, dtMs } = observation;
  if (
    ![
      self.x,
      self.y,
      self.hp,
      self.maxHp,
      player.x,
      player.y,
      player.hp,
      arena.minX,
      arena.maxX,
      reach,
      dtMs,
    ].every(Number.isFinite) ||
    dtMs < 0 ||
    self.maxHp <= 0 ||
    self.hp < 0 ||
    player.hp < 0 ||
    reach <= 0 ||
    arena.minX >= arena.maxX
  )
    throw new Error("Invalid enemy AI observation or elapsed time.");
  const next = { ...state };
  const command: EnemyAiCommand = { move: 0, jump: false, attack: false };
  if (self.hp === 0 || player.hp === 0 || dtMs === 0)
    return { state: next, command };

  // A suspended tab must not instantly consume an entire recovery or retreat.
  const elapsed = Math.min(dtMs, 100);
  next.remainingMs = Math.max(0, next.remainingMs - elapsed);
  next.attackCooldownMs = Math.max(0, next.attackCooldownMs - elapsed);
  next.dodgeCooldownMs = Math.max(0, next.dodgeCooldownMs - elapsed);
  next.retreatCooldownMs = Math.max(0, next.retreatCooldownMs - elapsed);
  if (self.hurt || self.punch !== "none") return { state: next, command };

  const distance = Math.abs(player.x - self.x);
  const verticalDistance = Math.abs(player.y - self.y);
  const toward: -1 | 1 =
    player.x === self.x ? self.facing : player.x > self.x ? 1 : -1;
  const away = -toward as -1 | 1;
  const canMove = (direction: -1 | 1) =>
    direction === 1 ? self.x < arena.maxX : self.x > arena.minX;

  // React to an observable punch, not the player's keys. Some tells remain punishable.
  if (
    next.mode !== "dodge" &&
    self.grounded &&
    verticalDistance < 45 &&
    (player.punch === "windup" || player.punch === "strike") &&
    distance <= reach * 1.25 &&
    next.dodgeCooldownMs === 0
  ) {
    next.dodgeCooldownMs = 1400; // Failed dodge rolls also wait, rather than re-rolling every frame.
    if (random() < 0.65) {
      next.mode = "dodge";
      next.remainingMs = 700;
      command.jump = true;
    }
  }
  if (next.mode === "dodge") {
    if (next.remainingMs > 0 || !self.grounded) {
      command.move = canMove(away) ? away : 0;
      return { state: next, command };
    }
    next.mode = "chase";
  }
  if (next.mode === "retreat") {
    if (next.remainingMs > 0 && canMove(away)) {
      command.move = away;
      return { state: next, command };
    }
    // A wall ends retreat early; re-engage instead of running into it forever.
    next.mode = "chase";
  }
  if (
    self.hp / self.maxHp <= 0.3 &&
    distance <= reach * 1.5 &&
    next.retreatCooldownMs === 0 &&
    canMove(away)
  ) {
    next.mode = "retreat";
    next.remainingMs = 600;
    next.retreatCooldownMs = 2500;
    command.move = away;
  } else if (
    distance <= reach * 0.9 &&
    verticalDistance < 45 &&
    self.grounded
  ) {
    if (next.attackCooldownMs === 0) {
      command.attack = true;
      next.attackCooldownMs = next.attackIntervalMs;
    }
  } else {
    command.move = canMove(toward) ? toward : 0;
  }
  return { state: next, command };
}
