/**
 * Connects the enemy professor AI (BackEnd/Game Engine/enemyProfessorAi.ts) to the arena: it
 * describes the arena to the AI each frame and passes the AI's controls back to the arena.
 * Only call it while the fight is running, never during a quiz or while waiting on the server.
 */
import {
  createEnemyAi,
  stepEnemyAi,
} from "../../../../BackEnd/Game Engine/enemyProfessorAi.ts";
import type { AiFighter } from "../../../../BackEnd/Game Engine/enemyProfessorAi.ts";
import { ARENA, punchPhase } from "./arena.ts";
import type { ArenaState, EnemyCommand, Fighter } from "./arena.ts";

/** Both fighters' health, as the server last reported it. */
export type ArenaHealth = {
  enemy: number;
  enemyMax: number;
  player: number;
  playerMax: number;
};

/** The enemy's mind for one fight. */
export type EnemyBrain = {
  /**
   * Decides what the enemy does this frame.
   * @param arena - The arena.
   * @param health - Both fighters' health.
   * @param seconds - How long the frame lasts.
   * @returns The enemy's controls.
   */
  decide(arena: ArenaState, health: ArenaHealth, seconds: number): EnemyCommand;
};

/**
 * Describes one fighter the way the AI sees them.
 * @param fighter - The fighter.
 * @param speed - How fast they run.
 * @param hp - Their health.
 * @param maxHp - Their max health.
 * @returns What the AI observes.
 */
function observe(
  fighter: Fighter,
  speed: number,
  hp: number,
  maxHp: number,
): AiFighter {
  return {
    x: fighter.x,
    y: fighter.y,
    vx: fighter.move * speed,
    vy: fighter.vy,
    grounded: fighter.y === 0 && fighter.vy === 0,
    facing: fighter.facing,
    punch: punchPhase(fighter),
    hurt: fighter.hurt > 0,
    hp,
    maxHp,
  };
}

/**
 * Creates the enemy's mind at the start of a fight.
 * @param stats - The professor's stats, which make faster professors attack more often.
 * @param speed - How fast the professor runs in the arena (see enemySpeed).
 * @param random - Random numbers for the AI's dodges; defaults to Math.random.
 * @returns The enemy brain.
 */
export function createEnemyBrain(
  stats:
    | { health: number; attack: number; defense: number; speed: number }
    | undefined,
  speed: number,
  random: () => number = Math.random,
): EnemyBrain {
  let state = createEnemyAi(stats);
  return {
    decide(arena, health, seconds) {
      const result = stepEnemyAi(
        state,
        {
          dtMs: seconds * 1000,
          self: observe(arena.enemy, speed, health.enemy, health.enemyMax),
          player: observe(
            arena.player,
            ARENA.playerSpeed,
            health.player,
            health.playerMax,
          ),
          arena: { minX: ARENA.left, maxX: ARENA.right },
          reach: ARENA.reach,
        },
        random,
      );
      state = result.state;
      return result.command;
    },
  };
}
