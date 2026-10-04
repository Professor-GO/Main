import { useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { ApiError, errorMessage } from "../../api/request";
import {
  battleAction,
  loadBattle,
  loadBattleQuestion,
  loadOwnedFighters,
  startBattle,
} from "../../features/world/battleApi";
import type {
  BattleAction,
  BattleView,
  OwnedFighter,
} from "../../features/world/battleApi";
import type { WildProfessor } from "../../features/world/Game Mechanics/game";
import { professorArt } from "../../features/world/art";
import "./BattleEncounter.css";
import BattleStage from "../../features/battle/BattleStage";
import { fighterArt, STUDENT_FIGHTER } from "../../features/battle/fighters";
import { NO_INPUT } from "../../features/battle/arena";
import type { ArenaInput } from "../../features/battle/arena";

// The keys that control the fighter, and what each one does.
const CONTROL_KEYS: Readonly<Record<string, keyof ArenaInput>> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "jump",
  KeyW: "jump",
  KeyJ: "punch",
};
// The on-screen controls, for touch screens and mouse players.
const CONTROL_BUTTONS: readonly {
  control: keyof ArenaInput;
  label: string;
  text: string;
}[] = [
  { control: "left", label: "Move left", text: "◀" },
  { control: "jump", label: "Jump", text: "▲ Jump" },
  { control: "right", label: "Move right", text: "▶" },
];

/** The real-time encounter fight and its three timed quiz interruptions. */
export default function BattleEncounter({
  professor,
  onLeave,
}: {
  // The professor met on the map, with the level they rolled when they appeared.
  professor: WildProfessor & { level: number };
  onLeave: () => void;
}) {
  const [battle, setBattle] = useState<BattleView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [now, setNow] = useState(Date.now());
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
  const summonTitle = useRef<HTMLHeadingElement>(null);
  // The latest battle, for commands sent between renders.
  const latest = useRef<BattleView | null>(null);
  // Landed punches waiting to be sent to the server, in the order they landed.
  const hits = useRef<("attack" | "enemyAttack")[]>([]);
  // Whether a landed punch is on its way to the server. The fight holds still until it is settled.
  const [settling, setSettling] = useState(false);
  // The controls the player is holding, read by the arena every frame.
  const input = useRef<ArenaInput>({ ...NO_INPUT });

  /** Shows a confirmed battle. Once the fight pauses or ends, punches still waiting are dropped. */
  function show(value: BattleView) {
    latest.current = value;
    if (value.status !== "fighting") {
      hits.current = [];
      input.current = { ...NO_INPUT };
    }
    if (value.status === "summoning") {
      setPlayerId(
        value.fighters?.find((fighter) => !fighter.defeated)?.id ?? "",
      );
    }
    setBattle(value);
  }

  // Lets go of every control when the window loses focus, so no key sticks down.
  useEffect(() => {
    const release = () => {
      input.current = { ...NO_INPUT };
    };
    window.addEventListener("blur", release);
    return () => window.removeEventListener("blur", release);
  }, []);

  useEffect(() => {
    let active = true;
    inventoryRequest.current ??= loadOwnedFighters();
    inventoryRequest.current
      .then((fighters) => {
        if (active) {
          setOwnedFighters(fighters);
          if (latest.current?.fighters == null)
            setPlayerId((current) => current || fighters[0]?.id || "");
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
    initial.current ??= startBattle(encounterId.current, professor.id, professor.level);
    let active = true;
    initial.current
      .then((value) => {
        if (active) show(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      });
    dialog.current?.focus();
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [professor.id]);

  const waiting = battle?.status === "question" && !battle.question;
  useEffect(() => {
    if (battle?.status === "summoning") summonTitle.current?.focus();
    else if (battle?.status === "fighting") dialog.current?.focus();
  }, [battle?.status]);
  useEffect(() => {
    if (!waiting || !battle) return;
    let active = true;
    setBusy(true);
    loadBattleQuestion(battle.id)
      .then((value) => {
        if (active) {
          show(value);
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

  /** Keeps a failed command unchanged until explicitly retried or refreshed. */
  async function send(kind: BattleAction["kind"], selectedIndex?: number) {
    const current = latest.current;
    if (!current || lock.current) return;
    const action = retry.current ?? {
      actionId: crypto.randomUUID(),
      version: current.version,
      kind,
      ...(kind === "summon" ? { professorId: playerId } : {}),
      ...(kind === "answer"
        ? { questionId: current.question?.id, selectedIndex }
        : {}),
    };
    // A landed punch settles quietly; the fight just holds still for a moment.
    const punch = action.kind === "attack" || action.kind === "enemyAttack";
    retry.current = action;
    lock.current = true;
    if (punch) setSettling(true);
    else setBusy(true);
    setError("");
    try {
      const value = await battleAction(current.id, action);
      if (mounted.current) {
        retry.current = null;
        setConflict(false);
        show(value);
      }
    } catch (cause) {
      if (mounted.current) {
        setError(errorMessage(cause));
        const conflicted = cause instanceof ApiError && cause.status === 409;
        setConflict(conflicted);
        if (conflicted) hits.current = [];
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        setSettling(false);
        sendNextHit();
      }
    }
  }

  /** Sends the next landed punch, once nothing else is on its way and the fight is still on. */
  function sendNextHit() {
    const next = hits.current[0];
    if (
      !next ||
      lock.current ||
      retry.current ||
      latest.current?.status !== "fighting"
    )
      return;
    hits.current.shift();
    void send(next);
  }

  /** Records a punch the arena saw land, for the server to settle. */
  function land(by: "player" | "enemy") {
    if (latest.current?.status !== "fighting") return;
    hits.current.push(by === "player" ? "attack" : "enemyAttack");
    sendNextHit();
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
        : await startBattle(encounterId.current, professor.id, professor.level);
      if (mounted.current) {
        retry.current = null;
        setError("");
        setConflict(false);
        show(value);
      }
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const ended = battle && ["won", "lost", "fled"].includes(battle.status);
  const seconds = Math.max(0, Math.ceil(((deadline ?? now) - now) / 1000));
  const art = professorArt(professor.id);
  const collection = battle?.fighters ?? ownedFighters;
  const available =
    collection?.filter(
      (fighter) => !("defeated" in fighter && fighter.defeated),
    ) ?? [];
  const selectedPlayer = collection?.find(
    (fighter) => fighter.id === (battle?.activeProfessorId || playerId),
  );
  const summonCandidate = battle?.fighters?.find(
    (fighter) => fighter.id === playerId,
  );
  const playerArt = selectedPlayer
    ? fighterArt(selectedPlayer.id, selectedPlayer.name)
    : STUDENT_FIGHTER;
  // The fight runs only while nothing needs settling: no quiz, no error, no punch on its way to the
  // server, no healing or knockout being shown, and the player's collection known.
  const running =
    battle?.status === "fighting" &&
    !error &&
    !busy &&
    !settling &&
    !animating &&
    collection !== null;

  /**
   * Makes an on-screen button hold a control while pressed. Pressing it with the keyboard
   * holds the control briefly instead.
   * @param control - The control.
   * @returns The button's event handlers.
   */
  function hold(control: keyof ArenaInput) {
    const release = () => {
      input.current[control] = false;
    };
    return {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (!running) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        input.current[control] = true;
      },
      onPointerUp: release,
      onPointerCancel: release,
      onLostPointerCapture: release,
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        if (!running || event.detail !== 0) return;
        input.current[control] = true;
        window.setTimeout(release, 150);
      },
    };
  }
  return (
    <div className="battle-overlay">
      <div
        className={`battle-card${battle?.status === "question" ? " is-quiz" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="battle-title"
        tabIndex={-1}
        ref={dialog}
        onKeyUp={(event) => {
          const control = CONTROL_KEYS[event.code];
          if (control) {
            input.current[control] = false;
            event.stopPropagation();
          }
        }}
        onKeyDown={(event) => {
          const control = CONTROL_KEYS[event.code];
          // The fighter selector uses the arrow keys itself.
          if (
            control &&
            running &&
            !(event.target instanceof HTMLSelectElement)
          ) {
            event.preventDefault();
            input.current[control] = true;
          }
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
              "KeyJ",
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
              document.activeElement === questionTitle.current ||
              document.activeElement === summonTitle.current)
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="battle-heading">
          {art && <img src={art} alt="" className="encounter-portrait" />}
          <div>
            <p className="eyebrow">WILD PROFESSOR BATTLE</p>
            <h2 id="battle-title">{professor.name}</h2>
            <p className="encounter-meta">
              {professor.rarity} · Lv. {professor.level} · {professor.department}
            </p>
          </div>
        </div>
        {battle ? (
          <>
            {battle.fighters == null &&
              battle.version === 0 &&
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
            {battle.status === "summoning" && (
              <section className="battle-summon" aria-labelledby="summon-title">
                <h3 id="summon-title" ref={summonTitle} tabIndex={-1}>
                  {battle.activeProfessorId
                    ? "Your professor was defeated. Summon another!"
                    : "Choose your first professor"}
                </h3>
                {available.length > 0 ? (
                  <>
                    <label className="battle-fighter-select">
                      Professor to summon
                      <select
                        value={playerId}
                        disabled={busy || !!error}
                        onChange={(event) => setPlayerId(event.target.value)}
                      >
                        {available.map((fighter) => (
                          <option key={fighter.id} value={fighter.id}>
                            {fighter.name} · Lv. {fighter.level}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy || !!error || !playerId}
                      onClick={() => void send("summon")}
                    >
                      Summon professor
                    </button>
                    <p>
                      The fight pauses while you choose. The enemy keeps its
                      remaining HP.
                    </p>
                    {summonCandidate && (
                      <p>
                        {summonCandidate.stats.health} HP ·{" "}
                        {summonCandidate.stats.attack} attack ·{" "}
                        {summonCandidate.stats.defense} defense ·{" "}
                        {summonCandidate.stats.speed} speed
                      </p>
                    )}
                  </>
                ) : (
                  <p>
                    No professors available. Recruit a professor from the lobby
                    before fighting.
                  </p>
                )}
                {battle.fighters?.some((fighter) => fighter.defeated) && (
                  <p>
                    Defeated:{" "}
                    {battle.fighters
                      .filter((fighter) => fighter.defeated)
                      .map((fighter) => fighter.name)
                      .join(", ")}
                  </p>
                )}
              </section>
            )}
            {battle.fighters == null &&
              (ownedFighters === null ? (
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
              ))}
            <BattleStage
              key={battle.activeProfessorId ?? "preview"}
              player={playerArt}
              enemy={fighterArt(professor.id, professor.name)}
              battle={battle}
              onAnimating={setAnimating}
              input={input}
              running={running}
              onLand={land}
              enemyStats={professor.stats}
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
                    : `${battle.feedback.timedOut ? "Time’s up!" : "Incorrect."} ${professor.name} recovered ${battle.feedback.healed} HP (${battle.feedback.healingPercent}% of lost HP).${battle.feedback.playerDamage !== undefined ? ` You lost ${battle.feedback.playerDamage} HP (80% of your current HP, rounded down).` : ""}`}
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
                  Answer in 10 seconds. A wrong answer or timeout heals the
                  professor for 50–80% of their lost HP and costs you 80% of
                  your current HP (damage rounded down).
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
                      ? "All your professors were defeated. Try again on your next encounter."
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
                <div
                  className="battle-controls"
                  role="group"
                  aria-label="Fight controls"
                >
                  {CONTROL_BUTTONS.map(({ control, label, text }) => (
                    <button
                      key={control}
                      type="button"
                      className={
                        control === "punch"
                          ? "primary-button"
                          : "secondary-button"
                      }
                      aria-label={label}
                      disabled={battle.status !== "fighting" || !!error}
                      {...hold(control)}
                    >
                      {text}
                    </button>
                  ))}
                  <span className="battle-attack-key">
                    <kbd>J</kbd> Attack
                  </span>
                  <button
                    type="button"
                    className="primary-button battle-touch-punch"
                    aria-label="Punch"
                    disabled={!running}
                    {...hold("punch")}
                  >
                    Punch · J
                  </button>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || animating || !!error}
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
  );
}
