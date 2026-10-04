import { useEffect, useLayoutEffect, useRef } from "react";
import type { BattleView } from "../world/battleApi";
import StickmanRig from "./StickmanRig";
import { StickmanController } from "./StickmanController";
import { battleBeats } from "./battleAnimation";
import type { BattleBeat } from "./battleAnimation";
import type { FighterArt, RigParts } from "./rig";
import "./BattleStage.css";

/** Two animated rigs driven by confirmed results, rather than the demo's local HP or keyboard combat. */
export default function BattleStage({
  player,
  enemy,
  battle,
  onAnimating,
}: {
  player: FighterArt;
  enemy: FighterArt;
  battle: BattleView;
  onAnimating: (animating: boolean) => void;
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
      actors.player.setReducedMotion(preference?.matches ?? false);
      actors.enemy.setReducedMotion(preference?.matches ?? false);
      if (previous.current?.status === "won") {
        actors.player.wave();
        actors.enemy.defeated();
      }
      if (previous.current?.status === "lost") {
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
        onAnimating(false);
        return;
      }
      playing.current = true;
      onAnimating(true);
      const next = () => pump.current();
      if (beat === "playerAttack")
        actors.player.attack(() => actors.enemy.hit(), next);
      else if (beat === "enemyAttack")
        actors.enemy.attack(() => actors.player.hit(), next);
      else if (beat === "enemyHit") actors.enemy.hit(next);
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
    queue.current.push(...battleBeats(previous.current, battle));
    previous.current = battle;
    if (!playing.current) pump.current();
  }, [battle]);

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
          transform="translate(154 37) scale(.48)"
        >
          <StickmanRig parts={playerParts} fighter={player} />
        </g>
        <g
          ref={enemyRoot}
          data-side="enemy"
          data-fighter={enemy.id}
          data-motion="idle"
          transform="translate(454 37) scale(.48)"
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
                : "Your turn · ready your next attack"}
      </figcaption>
    </figure>
  );
}
