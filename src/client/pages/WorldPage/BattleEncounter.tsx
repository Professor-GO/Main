import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/request";
import {
  battleAction,
  loadBattle,
  loadBattleQuestion,
  startBattle,
} from "../../features/world/battleApi";
import type { BattleAction, BattleView } from "../../features/world/battleApi";
import type { LegendaryProfessor } from "../../features/world/Game Mechanics/game";
import { professorArt } from "../../features/world/art";
import "./BattleEncounter.css";

/** The paused encounter fight and its three timed quiz interruptions. */
export default function BattleEncounter({
  professor,
  onLeave,
}: {
  professor: LegendaryProfessor;
  onLeave: () => void;
}) {
  const [battle, setBattle] = useState<BattleView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [now, setNow] = useState(Date.now());
  const encounterId = useRef(crypto.randomUUID());
  const initial = useRef<Promise<BattleView> | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const retry = useRef<BattleAction | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const questionTitle = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    mounted.current = true;
    initial.current ??= startBattle(encounterId.current, professor.id);
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
  }, [professor.id]);

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

  /** Keeps a failed command unchanged until explicitly retried or refreshed. */
  async function send(kind: BattleAction["kind"], selectedIndex?: number) {
    if (!battle || lock.current) return;
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
        : await startBattle(encounterId.current, professor.id);
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

  const ended = battle && ["won", "lost", "fled"].includes(battle.status);
  const seconds = Math.max(0, Math.ceil(((deadline ?? now) - now) / 1000));
  const art = professorArt(professor.id);
  return (
    <div className="battle-overlay">
      <div
        className="battle-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="battle-title"
        tabIndex={-1}
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
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
        <div className="battle-heading">
          {art && <img src={art} alt="" className="encounter-portrait" />}
          <div>
            <p className="eyebrow">WILD PROFESSOR BATTLE</p>
            <h2 id="battle-title">{professor.name}</h2>
            <p className="encounter-meta">Legendary · {professor.department}</p>
          </div>
        </div>
        {battle ? (
          <>
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
