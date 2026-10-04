/**
 * Real-time rules for the battle arena: running, jumping, punching, and whether a punch lands.
 * The player's keys drive one fighter and the enemy AI's commands drive the other. Nothing here
 * touches the DOM, so it runs (and is tested) in Node.
 *
 * The arena is seen from the side, in the battle SVG's units: x grows to the right and y is the
 * height above the ground. A landed punch is only reported here; the server decides the damage.
 */

/** Sizes, speeds, and timings. Distances are in arena units and times in seconds. */
export const ARENA = {
  // How far left and right a fighter's centre can go.
  left: 70,
  right: 730,
  // Where each fighter starts.
  playerStart: 250,
  enemyStart: 550,
  // Pulls fighters back down after a jump.
  gravity: 2200,
  // Upward speed at the start of a jump: about 130 units high and 0.7 seconds in the air.
  jumpSpeed: 760,
  playerSpeed: 240,
  // A punch reaches an opponent whose centre is this close, in the direction the puncher faces.
  reach: 85,
  // A punch passes under (or over) an opponent this much higher (or lower): how a jump dodges.
  dodgeHeight: 45,
  // The three parts of a punch: drawing back, the moment it can land, and recovering. The
  // professor draws back for longer, a visible tell that gives the player time to react.
  playerWindup: 0.14,
  enemyWindup: 0.3,
  strike: 0.08,
  recover: 0.22,
  // The shortest time between one punch and the next. The enemy's is longer (and just under the
  // enemy AI's own one-second minimum, so none of its attacks are dropped), and together they stay
  // well under the server's limit on battle actions a minute.
  playerCooldown: 0.6,
  enemyCooldown: 0.9,
  // How long a fighter who was just hit staggers, unable to move or punch.
  hurtTime: 0.3,
  // How far a landed punch knocks the opponent back.
  knockback: 24,
  // Fighters on the ground can't stand closer than this; in the air they can pass over each other.
  bodyWidth: 46,
  // A fighter at least this high is in the air, so the other can pass underneath.
  clearance: 40,
};

/** Which part of a punch a fighter is in. */
export type PunchPhase = "none" | "windup" | "strike" | "recover";
/** What a fighter looks like right now, for choosing their animation. */
export type Pose = "idle" | "walk" | "jump" | "punch" | "hurt";

/** One fighter in the arena. */
export type Fighter = {
  x: number;
  // Height above the ground.
  y: number;
  // Upward speed.
  vy: number;
  facing: 1 | -1;
  // Which way they are trying to run: -1 left, 1 right, 0 standing.
  move: -1 | 0 | 1;
  // How long their punch takes to draw back (see ARENA.playerWindup and ARENA.enemyWindup).
  windup: number;
  // Seconds since their punch started, or null if they are not punching.
  punchTime: number | null;
  // Whether the current punch has already landed, so it can only land once.
  punchLanded: boolean;
  // Seconds until they can punch again.
  cooldown: number;
  // Seconds of stagger left after being hit.
  hurt: number;
};

/** Both fighters. */
export type ArenaState = { player: Fighter; enemy: Fighter };

/** The keys (or on-screen buttons) the player is holding. */
export type ArenaInput = {
  left: boolean;
  right: boolean;
  jump: boolean;
  punch: boolean;
};

/** What the enemy AI wants to do this frame. */
export type EnemyCommand = {
  move: -1 | 0 | 1;
  jump: boolean;
  attack: boolean;
  facing?: -1 | 1;
};

/** Something that happened during a step: a punch landing, by whoever threw it. */
export type ArenaEvent = { kind: "hit"; by: "player" | "enemy" };

/** No keys held. */
export const NO_INPUT: ArenaInput = {
  left: false,
  right: false,
  jump: false,
  punch: false,
};

/**
 * Makes a fighter standing on the ground.
 * @param x - Where they stand.
 * @param facing - Which way they face.
 * @param windup - How long their punch takes to draw back.
 * @returns The fighter.
 */
function fighterAt(x: number, facing: 1 | -1, windup: number): Fighter {
  return {
    x,
    y: 0,
    vy: 0,
    facing,
    move: 0,
    windup,
    punchTime: null,
    punchLanded: false,
    cooldown: 0,
    hurt: 0,
  };
}

/**
 * Sets up the arena at the start of a fight, with the fighters facing each other.
 * @returns The arena.
 */
export function createArena(): ArenaState {
  return {
    player: fighterAt(ARENA.playerStart, 1, ARENA.playerWindup),
    enemy: fighterAt(ARENA.enemyStart, -1, ARENA.enemyWindup),
  };
}

/**
 * Works out how fast an enemy professor runs, from their speed stat.
 * @param stats - Their stats, if known.
 * @returns Their running speed, always a little slower than the player's.
 */
export function enemySpeed(stats?: { speed: number }): number {
  return Math.min(ARENA.playerSpeed - 10, 150 + (stats?.speed ?? 60));
}

/**
 * Finds which part of a punch a fighter is in.
 * @param fighter - The fighter.
 * @returns The part, or "none" if they are not punching.
 */
export function punchPhase(fighter: Fighter): PunchPhase {
  const time = fighter.punchTime;
  if (time === null) return "none";
  if (time < fighter.windup) return "windup";
  if (time < fighter.windup + ARENA.strike) return "strike";
  return "recover";
}

/**
 * Chooses the animation for a fighter.
 * @param fighter - The fighter.
 * @returns Their pose: staggering and punching come first, then being in the air, then running.
 */
export function poseOf(fighter: Fighter): Pose {
  if (fighter.hurt > 0) return "hurt";
  if (fighter.punchTime !== null) return "punch";
  if (fighter.y > 0) return "jump";
  return fighter.move ? "walk" : "idle";
}

/**
 * Moves one fighter for one frame: staggering, running, jumping, falling, and punching.
 * @param fighter - The fighter (changed in place).
 * @param move - Which way they want to run.
 * @param jump - Whether they want to jump.
 * @param punch - Whether they want to punch.
 * @param speed - How fast they run.
 * @param cooldown - The shortest time between their punches.
 * @param seconds - How long the frame lasts.
 */
function moveFighter(
  fighter: Fighter,
  move: -1 | 0 | 1,
  jump: boolean,
  punch: boolean,
  speed: number,
  cooldown: number,
  seconds: number,
): void {
  fighter.cooldown = Math.max(0, fighter.cooldown - seconds);
  fighter.hurt = Math.max(0, fighter.hurt - seconds);
  const grounded = fighter.y === 0 && fighter.vy === 0;
  const staggered = fighter.hurt > 0;

  if (fighter.punchTime !== null) {
    fighter.punchTime += seconds;
    if (fighter.punchTime >= fighter.windup + ARENA.strike + ARENA.recover)
      fighter.punchTime = null;
  }
  // Planting their feet to punch: someone punching on the ground can't run.
  const planted = fighter.punchTime !== null && grounded;
  fighter.move = staggered || planted ? 0 : move;
  fighter.x = clampX(fighter.x + fighter.move * speed * seconds);

  if (jump && grounded && !staggered) fighter.vy = ARENA.jumpSpeed;
  if (fighter.y > 0 || fighter.vy > 0) {
    fighter.y += fighter.vy * seconds;
    fighter.vy -= ARENA.gravity * seconds;
    if (fighter.y <= 0) {
      fighter.y = 0;
      fighter.vy = 0;
    }
  }

  if (
    punch &&
    fighter.punchTime === null &&
    fighter.cooldown === 0 &&
    !staggered
  ) {
    fighter.punchTime = 0;
    fighter.punchLanded = false;
    fighter.cooldown = cooldown;
  }
}

/**
 * Keeps a fighter's centre inside the arena.
 * @param x - Where they would be.
 * @returns Where they can be.
 */
function clampX(x: number): number {
  return Math.min(ARENA.right, Math.max(ARENA.left, x));
}

/**
 * Lands a punch if it is at the right moment and the opponent is in reach, in front, and not
 * jumping clear of it.
 * @param attacker - Who is punching (changed in place).
 * @param target - Who might be hit (changed in place).
 * @returns True if the punch landed.
 */
function resolvePunch(attacker: Fighter, target: Fighter): boolean {
  if (punchPhase(attacker) !== "strike" || attacker.punchLanded) return false;
  const dx = target.x - attacker.x;
  const inFront = dx === 0 || Math.sign(dx) === attacker.facing;
  if (
    !inFront ||
    Math.abs(dx) > ARENA.reach ||
    Math.abs(target.y - attacker.y) >= ARENA.dodgeHeight ||
    target.hurt > 0
  )
    return false;
  attacker.punchLanded = true;
  target.hurt = ARENA.hurtTime;
  // Being hit interrupts the target's own punch.
  target.punchTime = null;
  target.x = clampX(target.x + attacker.facing * ARENA.knockback);
  return true;
}

/**
 * Stops two fighters on the ground from standing inside each other.
 * @param a - One fighter (changed in place).
 * @param b - The other (changed in place).
 */
function separate(a: Fighter, b: Fighter): void {
  const dx = b.x - a.x;
  if (
    Math.abs(dx) >= ARENA.bodyWidth ||
    a.y >= ARENA.clearance ||
    b.y >= ARENA.clearance
  )
    return;
  const direction = dx < 0 ? -1 : 1;
  const half = ARENA.bodyWidth / 2;
  const middle = Math.min(
    ARENA.right - half,
    Math.max(ARENA.left + half, (a.x + b.x) / 2),
  );
  a.x = middle - direction * half;
  b.x = middle + direction * half;
}

/**
 * Runs the arena for one frame.
 * @param state - The arena before the frame (not changed).
 * @param input - The keys the player is holding.
 * @param command - What the enemy AI wants to do.
 * @param seconds - How long the frame lasts.
 * @param speed - How fast the enemy runs (see enemySpeed).
 * @param playerSpeed - How fast the player runs: ARENA.playerSpeed, raised by any level bonus.
 * @returns The arena after the frame, and the punches that landed during it.
 */
export function stepArena(
  state: ArenaState,
  input: ArenaInput,
  command: EnemyCommand,
  seconds: number,
  speed: number = enemySpeed(),
  playerSpeed: number = ARENA.playerSpeed,
): { state: ArenaState; events: ArenaEvent[] } {
  const player = { ...state.player };
  const enemy = { ...state.enemy };
  const playerMove = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) as
    | -1
    | 0
    | 1;
  moveFighter(
    player,
    playerMove,
    input.jump,
    input.punch,
    playerSpeed,
    ARENA.playerCooldown,
    seconds,
  );
  moveFighter(
    enemy,
    command.move,
    command.jump,
    command.attack,
    speed,
    ARENA.enemyCooldown,
    seconds,
  );
  separate(player, enemy);

  // Fighters turn to face each other, except mid-punch. The AI may choose its own facing.
  const toward = (from: Fighter, to: Fighter): 1 | -1 =>
    to.x >= from.x ? 1 : -1;
  if (player.punchTime === null) player.facing = toward(player, enemy);
  if (enemy.punchTime === null)
    enemy.facing = command.facing ?? toward(enemy, player);

  const events: ArenaEvent[] = [];
  if (resolvePunch(player, enemy)) events.push({ kind: "hit", by: "player" });
  if (resolvePunch(enemy, player)) events.push({ kind: "hit", by: "enemy" });
  return { state: { player, enemy }, events };
}
