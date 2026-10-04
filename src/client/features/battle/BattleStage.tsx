import { useEffect, useLayoutEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { BattleView } from "../world/battleApi";
import StickmanRig from "./StickmanRig";
import { StickmanController } from "./StickmanController";
import { battleBeats } from "./battleAnimation";
import type { BattleBeat } from "./battleAnimation";
import {
  ARENA,
  createArena,
  enemySpeed,
  poseOf,
  punchPhase,
  stepArena,
} from "./arena";
import type { ArenaInput, Pose } from "./arena";
import { createEnemyBrain } from "./enemyBrain";
import type { FighterArt, RigParts } from "./rig";
import "./BattleStage.css";

// Punches are animated live by the arena as they happen, so the server's record of them is not replayed.
const LIVE_BEATS: ReadonlySet<BattleBeat> = new Set([
  "playerAttack",
  "enemyAttack",
]);
// The rigs are drawn at this scale, and this far from their centre to the left edge of the rig.
const RIG_SCALE = 0.48;
const RIG_HALF_WIDTH = 200 * RIG_SCALE;
const RIG_TOP = 37;

/**
 * The real-time fight: the player's keys move their fighter, the enemy AI moves the professor,
 * and each punch that lands is reported through onLand for the server to settle. Quiz healing,
 * victory, defeat, and fleeing still play from the server's confirmed results.
 */
export default function BattleStage({
  player,
  enemy,
  battle,
  onAnimating,
  input,
  running,
  onLand,
  enemyStats,
}: {
  player: FighterArt;
  enemy: FighterArt;
  battle: BattleView;
  onAnimating: (animating: boolean) => void;
  // The keys (or on-screen buttons) the player is holding, read every frame.
  input: MutableRefObject<ArenaInput>;
  // Whether the fight is live. While false, both fighters freeze where they are.
  running: boolean;
  // Called when a punch lands: "player" when the player hit the professor, "enemy" for the reverse.
  onLand: (by: "player" | "enemy") => void;
  // The professor's stats, which set how fast they run and how often they attack.
  enemyStats?: {
    health: number;
    attack: number;
    defense: number;
    speed: number;
  };
}) {
  const playerParts = useRef<RigParts>({});
  const enemyParts = useRef<RigParts>({});
  const playerRoot = useRef<SVGGElement>(null);
  const enemyRoot = useRef<SVGGElement>(null);
  const controllers = useRef<{
    player: StickmanController;
    enemy: StickmanController;
  } | null>(null);
  const previous = useRef<BattleView | null>(null);
  const queue = useRef<BattleBeat[]>([]);
  const playing = useRef(false);
  const pump = useRef<() => void>(() => {});
  const arena = useRef(createArena());
  const speed = enemySpeed(enemyStats);
  const brain = useRef<ReturnType<typeof createEnemyBrain> | null>(null);
  brain.current ??= createEnemyBrain(enemyStats, speed);
  // The animation each rig is showing, so a new one starts only when the pose changes.
  const shown = useRef<{ player: Pose | null; enemy: Pose | null }>({
    player: null,
    enemy: null,
  });
  // The latest props, read by the frame loop without restarting it.
  const latest = useRef({ battle, running, onLand, speed });
  useLayoutEffect(() => {
    latest.current = { battle, running, onLand, speed };
  });

  useLayoutEffect(() => {
    if (!playerRoot.current || !enemyRoot.current) return;
    const actors = {
      player: new StickmanController(
        playerParts.current,
        1,
        playerRoot.current,
      ),
      enemy: new StickmanController(enemyParts.current, -1, enemyRoot.current),
    };
    controllers.current = actors;
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const configure = () => {
      queue.current = [];
      playing.current = false;
      onAnimating(false);
      shown.current = { player: null, enemy: null };
      actors.player.setReducedMotion(preference?.matches ?? false);
      actors.enemy.setReducedMotion(preference?.matches ?? false);
      if (previous.current?.status === "won") {
        actors.player.wave();
        actors.enemy.defeated();
      }
      if (
        previous.current?.status === "lost" ||
        (previous.current?.status === "summoning" &&
          previous.current.activeProfessorId)
      ) {
        actors.player.defeated();
        actors.enemy.wave();
      }
      if (previous.current?.status === "fled") actors.player.flee(() => {});
    };
    configure();
    preference?.addEventListener("change", configure);
    pump.current = () => {
      if (controllers.current !== actors) return;
      const beat = queue.current.shift();
      if (!beat) {
        playing.current = false;
        // The arena chooses each rig's animation again once the beats are over.
        shown.current = { player: null, enemy: null };
        onAnimating(false);
        return;
      }
      playing.current = true;
      onAnimating(true);
      const next = () => pump.current();
      if (beat === "enemyHit") actors.enemy.hit(next);
      else if (beat === "playerHit") actors.player.hit(next);
      else if (beat === "heal") actors.enemy.heal(next);
      else {
        if (beat === "won") {
          actors.enemy.defeated();
          actors.player.wave();
        }
        if (beat === "lost") {
          actors.player.defeated();
          actors.enemy.wave();
        }
        if (beat === "fled") {
          actors.player.flee(next);
          return;
        }
        next();
      }
    };
    return () => {
      preference?.removeEventListener("change", configure);
      actors.player.destroy();
      actors.enemy.destroy();
      controllers.current = null;
      previous.current = null;
      queue.current = [];
      playing.current = false;
    };
  }, [onAnimating]);

  useEffect(() => {
    queue.current.push(
      ...battleBeats(previous.current, battle).filter(
        (beat) => !LIVE_BEATS.has(beat),
      ),
    );
    previous.current = battle;
    if (!playing.current) pump.current();
  }, [battle]);

  // The frame loop: moves both fighters, reports landed punches, and redraws the rigs.
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // A long gap (such as a hidden tab) counts as one short step, so nothing jumps.
      const seconds = Math.min(Math.max(now - last, 0) / 1000, 0.05);
      last = now;
      const actors = controllers.current;
      const {
        battle: current,
        running: live,
        onLand: land,
        speed: run,
      } = latest.current;
      if (actors && live && !playing.current && seconds > 0 && brain.current) {
        const command = brain.current.decide(
          arena.current,
          {
            enemy: current.health,
            enemyMax: current.maxHealth,
            player: current.playerHealth,
            playerMax: current.playerMaxHealth,
          },
          seconds,
        );
        const result = stepArena(
          arena.current,
          input.current,
          command,
          seconds,
          run,
        );
        arena.current = result.state;
        draw(actors);
        for (const event of result.events) land(event.by);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [input]);

  /**
   * Moves each rig to its fighter's place and starts a new animation when their pose changes.
   * @param actors - The two rigs' controllers.
   */
  function draw(actors: {
    player: StickmanController;
    enemy: StickmanController;
  }) {
    for (const side of ["player", "enemy"] as const) {
      const fighter = arena.current[side];
      const root = side === "player" ? playerRoot.current : enemyRoot.current;
      root?.setAttribute(
        "transform",
        `translate(${fighter.x - RIG_HALF_WIDTH} ${RIG_TOP - fighter.y}) scale(${RIG_SCALE})`,
      );
      if (root) root.dataset.tell = String(punchPhase(fighter) === "windup");
      const actor = actors[side];
      actor.face(fighter.facing);
      const pose = poseOf(fighter);
      if (pose === shown.current[side]) continue;
      shown.current[side] = pose;
      if (pose === "punch")
        actor.punch(fighter.windup, ARENA.strike, ARENA.recover);
      else if (pose === "hurt") actor.hit();
      else if (pose === "jump") actor.jump();
      else if (pose === "walk") actor.walk();
      else actor.idle();
    }
  }

  return (
    <figure
      className={`battle-stage${battle.status === "question" ? " is-question" : ""}`}
    >
      <div className="battle-fighter-labels">
        <span>
          <small>YOUR FIGHTER</small>
          {player.name}
        </span>
        <span>
          <small>WILD PROFESSOR</small>
          {enemy.name}
        </span>
      </div>
      <svg
        viewBox="0 0 800 330"
        role="img"
        aria-label={`${player.name} facing ${enemy.name} in the battle arena`}
        className="battle-arena"
      >
        <defs>
          <linearGradient id="battle-sky" x2="0" y2="1">
            <stop stopColor="#193b42" />
            <stop offset="1" stopColor="#427061" />
          </linearGradient>
        </defs>
        <rect width="800" height="330" rx="12" fill="url(#battle-sky)" />
        <path
          d="M0 215 L90 160 L155 191 L251 138 L330 200 L408 160 L500 215 L610 146 L715 190 L800 153 V330 H0Z"
          fill="#183e34"
          opacity=".65"
        />
        <path d="M0 278 Q400 235 800 278 V330 H0Z" fill="#263e30" />
        <ellipse
          cx="400"
          cy="294"
          rx="282"
          ry="20"
          fill="none"
          stroke="#9bb56a"
          strokeWidth="2"
          opacity=".45"
        />
        <g
          ref={playerRoot}
          data-side="player"
          data-fighter={player.id}
          data-motion="idle"
          transform={`translate(${ARENA.playerStart - RIG_HALF_WIDTH} ${RIG_TOP}) scale(${RIG_SCALE})`}
        >
          <StickmanRig parts={playerParts} fighter={player} />
        </g>
        <g
          ref={enemyRoot}
          data-side="enemy"
          data-fighter={enemy.id}
          data-motion="idle"
          transform={`translate(${ARENA.enemyStart - RIG_HALF_WIDTH} ${RIG_TOP}) scale(${RIG_SCALE})`}
        >
          <StickmanRig parts={enemyParts} fighter={enemy} />
        </g>
        {battle.feedback && !battle.feedback.correct && (
          <text
            className="battle-heal-number"
            x="550"
            y="30"
            textAnchor="middle"
            fill="#cbf79e"
            fontSize="25"
            fontWeight="bold"
          >
            +{battle.feedback.healed} HP
          </text>
        )}
      </svg>
      <figcaption>
        {battle.status === "question"
          ? "Combat paused · answer the professor’s challenge"
          : battle.status === "won"
            ? "Victory!"
            : battle.status === "lost"
              ? "Your fighter is down"
              : battle.status === "fled"
                ? "Leaving the fight"
                : battle.status === "summoning"
                  ? "Combat paused · choose a professor to summon"
                  : "← → or A D to move · ↑ or W to jump · J to attack. Jump when the professor winds up!"}
      </figcaption>
    </figure>
  );
}
