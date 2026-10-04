import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ApiError, errorMessage } from "../../api/request";
import { loadInventory } from "../../features/world/api";
import type { OwnedCage } from "../../features/world/api";
import {
  battleAction,
  catchProfessor,
  loadBattle,
  loadBattleQuestion,
  loadOwnedFighters,
  startBattle,
} from "../../features/world/battleApi";
import type { BattleAction, BattleView } from "../../features/world/battleApi";
import type { WildProfessor } from "../../features/world/Game Mechanics/game";
import { ARENA_ART, CAGE_ART } from "../../features/world/art";
import Stickman from "../../features/stickman/Stickman";
import type { StickmanHandle } from "../../features/stickman/Stickman";
import { lookFor } from "../../features/stickman/looks";
import type {
  BattleAction,
  BattleView,
  OwnedFighter,
} from "../../features/world/battleApi";
import type { LegendaryProfessor } from "../../features/world/Game Mechanics/game";
import { professorArt } from "../../features/world/art";
import "./BattleEncounter.css";
import BattleStage from "../../features/battle/BattleStage";
import { fighterArt, STUDENT_FIGHTER } from "../../features/battle/fighters";

/** Who the player sends into the battle: one of their professors, or null for themselves. */
export type Fighter = { id: string; name: string } | null;

// The battle is drawn in a 600 × 338 space, the shape of the clearing's picture. The player's
// side stands on the near patch of earth and the wild professor on the far one.
const SCENE = { width: 600, height: 338 };
const NEAR = { x: 205, y: 300, scale: 0.4 };
const FAR = { x: 470, y: 190, scale: 0.27 };

/**
 * The battle scene: the wild professor and the player's fighter face each other in a grassy
 * clearing, shaking left and right. Attacks play out as punches, three timed quizzes
 * interrupt the fight, and a defeated professor can be caught by throwing a cage at them.
 */
export default function BattleEncounter({
  professor,
  fighter = null,
  onLeave,
}: {
  professor: Pick<WildProfessor, "id" | "name" | "department"> & {
    rarity?: string;
  };
  fighter?: Fighter;
  onLeave: () => void;
}) {
  const [battle, setBattle] = useState<BattleView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [now, setNow] = useState(Date.now());
  // The player's cages, loaded once the professor is defeated, and how the catch went.
  const [cages, setCages] = useState<OwnedCage[] | null>(null);
  const [caught, setCaught] = useState("");
  const [animating, setAnimating] = useState(false);
  const [ownedFighters, setOwnedFighters] = useState<OwnedFighter[] | null>(
    null,
  );
  const [playerId, setPlayerId] = useState("");
  const [collectionError, setCollectionError] = useState("");
  const inventoryRequest = useRef<Promise<OwnedFighter[]> | null>(null);
  const encounterId = useRef(crypto.randomUUID());
  const initial = useRef<Promise<BattleView> | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const retry = useRef<BattleAction | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const questionTitle = useRef<HTMLHeadingElement>(null);
  const near = useRef<StickmanHandle>(null);
  const far = useRef<StickmanHandle>(null);
  const cage = useRef<SVGImageElement>(null);
  const fighterId = fighter?.id ?? null;

  useEffect(() => {
    let active = true;
    inventoryRequest.current ??= loadOwnedFighters();
    inventoryRequest.current
      .then((fighters) => {
        if (active) {
          setOwnedFighters(fighters);
          setPlayerId(fighters[0]?.id ?? "");
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setOwnedFighters([]);
          setCollectionError(errorMessage(cause));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    mounted.current = true;
    initial.current ??= startBattle(
      encounterId.current,
      professor.id,
      fighterId,
    if (!ownedFighters) return;
    const chosenProfessor = playerId || ownedFighters[0]?.id || undefined;
    initial.current ??= startBattle(
      encounterId.current,
      professor.id,
      chosenProfessor,
    );
    let active = true;
    initial.current
      .then((value) => {
        if (active) setBattle(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      });
    dialog.current?.focus();
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [professor.id, fighterId]);

  // Stands both stickmen on their patches of earth, facing each other and ready to fight.
  useLayoutEffect(() => {
    near.current?.element?.setAttribute(
      "transform",
      `translate(${NEAR.x} ${NEAR.y})`,
    );
    far.current?.element?.setAttribute(
      "transform",
      `translate(${FAR.x} ${FAR.y})`,
    );
    far.current?.controller?.setDirection(-1);
    near.current?.controller?.sway();
    far.current?.controller?.sway();
    const thrown = cage.current;
    return () => {
      if (thrown) gsap.killTweensOf(thrown);
    };
  }, []);
  }, [professor.id, ownedFighters, playerId]);

  const waiting = battle?.status === "question" && !battle.question;
  useEffect(() => {
    if (!waiting || !battle) return;
    let active = true;
    setBusy(true);
    loadBattleQuestion(battle.id)
      .then((value) => {
        if (active) {
          setBattle(value);
          setError("");
          setBusy(false);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(errorMessage(cause));
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [waiting, battle?.id, battle?.version]);

  const deadline = battle?.question?.expiresAt;
  useEffect(() => {
    if (deadline === undefined) return;
    questionTitle.current?.focus();
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [deadline]);
  useEffect(() => {
    if (
      deadline !== undefined &&
      now >= deadline &&
      !busy &&
      !error &&
      !lock.current
    )
      void send("timeout");
  }, [deadline, now, busy, error]);

  // Once the professor is defeated, find out which cages the player can throw.
  const won = battle?.status === "won";
  useEffect(() => {
    if (!won) return;
    let active = true;
    loadInventory()
      .then((owned) => {
        if (active) setCages(owned.cages.filter((owned) => owned.quantity > 0));
      })
      .catch(() => {
        // Without their cages the player can still walk away from the battle.
        if (active) setCages([]);
      });
    return () => {
      active = false;
    };
  }, [won]);

  /** Plays the punches for a turn: the player's side strikes, and the professor may hit back. */
  function playTurn(before: BattleView, after: BattleView) {
    near.current?.controller?.attack(() => {
      if (after.health < before.health) far.current?.controller?.hit();
    });
    if (after.playerHealth < before.playerHealth)
      window.setTimeout(() => {
        if (mounted.current)
          far.current?.controller?.attack(() =>
            near.current?.controller?.hit(),
          );
      }, 750);
  }

  /** Keeps a failed command unchanged until explicitly retried or refreshed. */
  async function send(kind: BattleAction["kind"], selectedIndex?: number) {
    if (
      !battle ||
      lock.current ||
      (kind === "attack" && (animating || ownedFighters === null))
    )
      return;
    const action = retry.current ?? {
      actionId: crypto.randomUUID(),
      version: battle.version,
      kind,
      ...(kind === "answer"
        ? { questionId: battle.question?.id, selectedIndex }
        : {}),
    };
    retry.current = action;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await battleAction(battle.id, action);
      if (mounted.current) {
        if (action.kind === "attack") playTurn(battle, value);
        setBattle(value);
        retry.current = null;
        setConflict(false);
      }
    } catch (cause) {
      if (mounted.current) {
        setError(errorMessage(cause));
        setConflict(cause instanceof ApiError && cause.status === 409);
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  /** Retries reads/start, or reconciles a version conflict without repeating damage. */
  async function refresh() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const value = battle
        ? await (waiting
            ? loadBattleQuestion(battle.id)
            : loadBattle(battle.id))
        : await startBattle(encounterId.current, professor.id, fighterId);
      if (mounted.current) {
        setBattle(value);
        setError("");
        setConflict(false);
        retry.current = null;
      }
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  /**
   * Throws a cage at the defeated professor. The server spends the cage and adds the
   * professor to the player's inventory; then the cage flies over and lands on them.
   */
  async function throwCage(owned: OwnedCage) {
    if (!battle || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await catchProfessor(battle.id, owned.id);
      if (!mounted.current) return;
      setBattle(result.battle); Can’t automatically merge. Don’t worry, you can still create the pull request. 
      const image = cage.current;
      if (image) {
        image.setAttribute(
          "href",
          CAGE_ART[owned.id] ?? CAGE_ART["bronze-cage"],
        );
        // The cage arcs from the player's side to the professor, spinning, then drops over
        // them and rocks from side to side as it settles.
        gsap.set(image, {
          opacity: 1,
          x: NEAR.x,
          y: NEAR.y - 150,
          scale: 0.4,
          rotation: 0,
          transformOrigin: "50% 50%",
        });
        gsap
          .timeline()
          .to(
            image,
            {
              x: FAR.x - 45,
              rotation: 360,
              scale: 1,
              duration: 0.8,
              ease: "none",
            },
            0,
          )
          .to(image, { y: FAR.y - 250, duration: 0.4, ease: "power2.out" }, 0)
          .to(image, { y: FAR.y - 112, duration: 0.4, ease: "power2.in" }, 0.4)
          .to(image, {
            rotation: 372,
            duration: 0.12,
            yoyo: true,
            repeat: 5,
            ease: "sine.inOut",
          })
          .to(image, { rotation: 360, duration: 0.1 });
      }
      far.current?.controller?.idle();
      setCaught(
        result.isNew
          ? `Gotcha! ${professor.name} joins your faculty.`
          : `Gotcha! You now have ${result.copies} copies of ${professor.name}.`,
      );
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const ended = battle && ["won", "lost", "fled"].includes(battle.status);
  const seconds = Math.max(0, Math.ceil(((deadline ?? now) - now) / 1000));
  const fighterName = fighter?.name ?? "You";
  const art = professorArt(professor.id);
  const selectedPlayer = ownedFighters?.find(
    (fighter) => fighter.id === playerId,
  );
  const playerArt = selectedPlayer
    ? fighterArt(selectedPlayer.id, selectedPlayer.name)
    : STUDENT_FIGHTER;
  return (
    <div className="battle-overlay">
      <div
        className={`battle-card${battle?.status === "question" ? " is-quiz" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="battle-title"
        tabIndex={-1}
        ref={dialog}
        onKeyDown={(event) => {
          if (
            [
              "ArrowUp",
              "ArrowDown",
              "ArrowLeft",
              "ArrowRight",
              "KeyW",
              "KeyA",
              "KeyS",
              "KeyD",
            ].includes(event.code)
          )
            event.stopPropagation();
          if (event.key !== "Tab") return;
          const buttons = dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), select:not(:disabled)",
          );
          if (!buttons?.length) {
            event.preventDefault();
            return;
          }
          const first = buttons[0],
            last = buttons[buttons.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === dialog.current ||
              document.activeElement === questionTitle.current)
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="battle-scene">
          <img className="battle-arena" src={ARENA_ART} alt="" />
          <svg
            className="battle-stage"
            viewBox={`0 0 ${SCENE.width} ${SCENE.height}`}
            aria-hidden="true"
          >
            <Stickman
              ref={far}
              look={lookFor(professor.id)}
              scale={FAR.scale}
              className={
                battle?.status === "won" && !battle.caught ? "is-down" : ""
              }
            />
            <image ref={cage} className="battle-cage" width="90" height="105" />
            <Stickman
              ref={near}
              look={lookFor(fighter?.id ?? "main")}
              facing="back"
              scale={NEAR.scale}
              className={battle?.status === "lost" ? "is-down" : ""}
            />
          </svg>
          <div className="battle-heading">
            <p className="eyebrow">WILD PROFESSOR BATTLE</p>
            <h2 id="battle-title">{professor.name}</h2>
            <p className="encounter-meta">
              {professor.rarity ? `${professor.rarity} · ` : ""}
              {professor.department}
            </p>
            {battle && (
              <label className="battle-health">
                Professor HP{" "}
                <span>
                  {battle.health} / {battle.maxHealth}
                </span>
                <progress
                  aria-label="Professor HP"
                  value={battle.health}
                  max={battle.maxHealth}
                />
              </label>
            )}
          </div>
          {battle && (
            <label className="battle-health battle-health-own">
              {fighter ? `${fighterName} HP` : "Your HP"}{" "}
              <span>
                {battle.playerHealth} / {battle.playerMaxHealth}
              </span>
              <progress
                aria-label="Your HP"
                value={battle.playerHealth}
                max={battle.playerMaxHealth}
              />
            </label>
          )}
        </div>
        <div className="battle-panel">
          {battle ? (
            <>
              {battle.feedback && (
                <div className="battle-feedback" role="status">
                  <strong>
                    {battle.feedback.correct
                      ? "Correct! No healing penalty."
                      : `${battle.feedback.timedOut ? "Time’s up!" : "Incorrect."} ${professor.name} recovered ${battle.feedback.healed} HP (${battle.feedback.healingPercent}% of lost HP).`}
                  </strong>
                  <p>{battle.feedback.explanation}</p>
                </div>
              )}
              {battle.status === "question" && (
                <section
                  className="battle-quiz"
                  aria-labelledby="battle-question-title"
                >
                  <h3
                    id="battle-question-title"
                    tabIndex={-1}
                    ref={questionTitle}
                  >
                    Pop quiz {battle.eventNumber} / 3
                  </h3>
                  <p>
                    Answer in 10 seconds. A wrong answer or timeout heals 50–80%
                    of lost HP.
                  </p>
                  {battle.question ? (
                    <>
                      <p
                        className="battle-countdown" Can’t automatically merge. Don’t worry, you can still create the pull request. 
                        aria-label={`${seconds} seconds remaining`}
                      >
                        {seconds}s left
                      </p>
                      <p className="battle-question-text">
                        {battle.question.question} Can’t automatically merge. Don’t worry, you can still create the pull request. 
                      </p>
                      <div
                        className="battle-choices"
                        role="group"
                        aria-label="Answer choices"
                      >
                        {battle.question.choices.map((choice, index) => (
                          <button
                            key={index}
                            type="button"
                            disabled={busy || !!error || seconds === 0}
                            onClick={() => void send("answer", index)}
                          >
                            <b>{String.fromCharCode(65 + index)}.</b> {choice}
                          </button>
                        ))}
                      </div>
                      {battle.question.message && (
                        <p>{battle.question.message}</p>
                      )}
                    </>
                  ) : (
                    <p role="status">Preparing your question…</p>
                  )}
                </section>
              )} Can’t automatically merge. Don’t worry, you can still create the pull request. 
              {ended ? (
                <>
                  <p className="battle-outcome">
                    {caught ||
                      (battle.status === "won"
                        ? "You defeated the professor!"
                        : battle.status === "lost"
                          ? `${fighter ? `${fighterName} ran` : "You ran"} out of HP. Try again on your next encounter.`
                          : "You left the battle.")}
                  </p>
                  {battle.status === "won" &&
                    !battle.caught &&
                    !!cages?.length && (
                      <div
                        className="battle-catch"
                        role="group"
                        aria-label="Throw a cage to catch them"
                      >
                        <p>
                          Throw a cage to catch {professor.name}, or let them
                          go.
                        </p>
                        {cages.map((owned) => (
                          <button
                            key={owned.id}
                            type="button"
                            className="secondary-button"
                            disabled={busy}
                            onClick={() => void throwCage(owned)}
                          >
                            Throw {owned.name} ({owned.quantity})
                          </button>
                        ))}
                      </div>
                    )}
                  {battle.status === "won" &&
                    !battle.caught &&
                    cages?.length === 0 && (
                      <p className="battle-note">
                        You have no cages to catch them with. The gashapon
                        machine in the school gives cages.
                      </p>
                    )}
                  <button
                    type="button"
                    className="primary-button"
                    onClick={onLeave}
                  >
                    Keep exploring →
                  </button>
                </>
              ) : (
                <div className="battle-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || !!error || battle.status !== "fighting"}
                    onClick={() => void send("attack")}
                  >
                    Attack
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || !!error}
                    onClick={() => void send("flee")}
                  >
                    Run away
                  </button>
                </div>
              )}
            </>
          ) : (
            <p role="status">Starting the battle…</p>
          )}
          {error && (
            <div role="alert">
              <p>{error}</p>
        </div>
 Can’t automatically merge. Don’t worry, you can still create the pull request.         {battle ? (
          <>
            {battle.version === 0 &&
              ownedFighters !== null &&
              ownedFighters.length > 0 && (
                <label className="battle-fighter-select">
                  Battle as
                  <select
                    value={playerId}
                    disabled={busy || animating}
                    onChange={(event) => setPlayerId(event.target.value)}
                  >
                    {ownedFighters.map((fighter) => (
                      <option key={fighter.id} value={fighter.id}>
                        {fighter.name} · Lv. {fighter.level}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            {ownedFighters === null ? (
              <p className="battle-collection-note" role="status">
                Loading your professors…
              </p>
            ) : (
              ownedFighters.length === 0 && (
                <p className="battle-collection-note">
                  {collectionError
                    ? "Your collection could not be loaded. You can still practice with the student."
                    : "No recruited professors yet. Practice with the student."}
                </p>
              )
            )}
            <BattleStage
              player={playerArt}
              enemy={fighterArt(professor.id, professor.name)}
              battle={battle}
              onAnimating={setAnimating}
            />
            <div className="battle-health-bars">
              <label className="battle-health">
                Your HP{" "}
                <span>
                  {battle.playerHealth} / {battle.playerMaxHealth}
                </span>
                <progress
                  aria-label="Your HP"
                  value={battle.playerHealth}
                  max={battle.playerMaxHealth}
                />
              </label>
              <label className="battle-health">
                Professor HP{" "}
                <span>
                  {battle.health} / {battle.maxHealth}
                </span>
                <progress
                  aria-label="Professor HP"
                  value={battle.health}
                  max={battle.maxHealth}
                />
              </label>
            </div>
            {battle.feedback && (
              <div className="battle-feedback" role="status">
                <strong>
                  {battle.feedback.correct
                    ? "Correct! No healing penalty."
                    : `${battle.feedback.timedOut ? "Time’s up!" : "Incorrect."} ${professor.name} recovered ${battle.feedback.healed} HP (${battle.feedback.healingPercent}% of max HP).${battle.feedback.playerDamage !== undefined ? ` You lost ${battle.feedback.playerDamage} HP (5–12% of your current HP, capped at 15).` : ""}`}
                </strong>
                <p>{battle.feedback.explanation}</p>
              </div>
            )}
            {battle.status === "question" && (
              <section
                className="battle-quiz"
                aria-labelledby="battle-question-title"
              >
                <h3
                  id="battle-question-title"
                  tabIndex={-1}
                  ref={questionTitle}
                >
                  Pop quiz {battle.eventNumber} / 3
                </h3>
                <p>
                  Answer in 30 seconds. A wrong answer or timeout heals the
                  professor for 10–20% of their max HP and costs you 5–12% of
                  your current HP, capped at 15.
                </p>
                {battle.question ? (
                  <>
                    <p
                      className="battle-countdown"
                      aria-label={`${seconds} seconds remaining`}
                    >
                      {seconds}s left
                    </p>
                    <p className="battle-question-text">
                      {battle.question.question}
                    </p>
                    <div
                      className="battle-choices"
                      role="group"
                      aria-label="Answer choices"
                    >
                      {battle.question.choices.map((choice, index) => (
                        <button
                          key={index}
                          type="button"
                          disabled={busy || !!error || seconds === 0}
                          onClick={() => void send("answer", index)}
                        >
                          <b>{String.fromCharCode(65 + index)}.</b> {choice}
                        </button>
                      ))}
                    </div>
                    {battle.question.message && (
                      <p>{battle.question.message}</p>
                    )}
                  </>
                ) : (
                  <p role="status">Preparing your question…</p>
                )}
              </section>
            )}
            {ended ? (
              <>
                <p className="battle-outcome">
                  {battle.status === "won"
                    ? "You defeated the professor!"
                    : battle.status === "lost"
                      ? "You ran out of HP. Try again on your next encounter."
                      : "You left the battle."}
                </p>
                <button
                  type="button"
                  className="primary-button"
                  onClick={onLeave}
                >
                  Keep exploring →
                </button>
              </>
            ) : (
              <div className="battle-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={
                    busy ||
                    animating ||
                    ownedFighters === null ||
                    !!error ||
                    battle.status !== "fighting"
                  }
                  onClick={() => void send("attack")}
                >
                  Attack
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || animating || !!error}
                  onClick={() => void send("flee")}
                >
                  Run away
                </button> Can’t automatically merge. Don’t worry, you can still create the pull request. 
              </div>
            )}
          </>
        ) : (
          <p role="status">Starting the battle…</p>
        )}
        {error && (
          <div role="alert">
            <p>{error}</p>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() =>
                retry.current && !conflict
                  ? void send(retry.current.kind)
                  : void refresh()
              }
            >
              {conflict ? "Refresh battle" : "Retry"}
            </button>
            {!battle && (
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  retry.current && !conflict
                    ? void send(retry.current.kind)
                    : void refresh()
                }
              >
                {conflict ? "Refresh battle" : "Retry"}
              </button>
              {!battle && (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={onLeave}
                >
                  Keep exploring
                </button>
              )}
            </div>
          )}
          {busy && (
            <p className="battle-pending" role="status">
              {waiting ? "Generating a question…" : "Updating battle…"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
