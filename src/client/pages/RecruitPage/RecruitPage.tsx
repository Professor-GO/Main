import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/request";
import { loadMachine, pullProfessor } from "../../features/recruitment/api";
import type {
  Machine,
  PityProgress,
  RecruitedProfessor,
} from "../../features/recruitment/api";
import {
  CAGE_ART,
  CAPSULE_ART,
  MACHINE_ART,
  professorArt,
} from "../../features/recruitment/art";
import { CAPSULE_FOR } from "../../features/recruitment/capsules";
import GashaponGlobe from "./GashaponGlobe";
import "./RecruitPage.css";

/**
 * The steps of one pull. The machine shakes while the server picks the professor, then the
 * capsule drops out, wobbles, and pops open to show the professor in their cage.
 */
type Phase = "idle" | "shaking" | "dropping" | "wobbling" | "opening" | "revealed";

/** How long each step lasts, in milliseconds. Legendary capsules wobble longer. */
const TIMING = {
  shake: 1700,
  drop: 950,
  wobble: 900,
  legendaryWobble: 1800,
  open: 650,
};

type RecruitPageProps = {
  tokens: number;
  onBack: () => void;
  onTokens: (tokens: number) => void;
  onQuestion: () => void;
};

const numbers = new Intl.NumberFormat();
const percent = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

/** True when the player has asked their system for less motion. */
function prefersStill(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Describes how close the player is to a guaranteed Epic or Legendary professor.
 * @param pity - Pulls in a row without one, and the size of the guarantee.
 * @returns A sentence for the pity bar.
 */
function pityMessage({ count, guarantee }: PityProgress): string {
  const left = guarantee - count;
  return left <= 1
    ? "Your next pull is a guaranteed Epic or Legendary professor!"
    : `An Epic or Legendary professor is guaranteed within ${left} pulls.`;
}

export default function RecruitPage({
  tokens,
  onBack,
  onTokens,
  onQuestion,
}: RecruitPageProps) {
  const title = useRef<HTMLHeadingElement>(null);
  const [machine, setMachine] = useState<Machine | null>(null);
  const [loadError, setLoadError] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [prize, setPrize] = useState<RecruitedProfessor | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Warming up the machine…");
  const timers = useRef<number[]>([]);
  // Finishes the current pull at once: shows the professor and the new pity and balance.
  const finish = useRef<(() => void) | null>(null);
  const skipped = useRef(false);
  // Ends the shaking early, when the player skips before the server has answered.
  const endShake = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const firstLoad = useRef<Promise<Machine> | null>(null);

  useEffect(() => {
    mounted.current = true;
    document.title = "Recruit · Professor-Go";
    title.current?.focus();
    let active = true;
    firstLoad.current ??= loadMachine();
    firstLoad.current
      .then((loaded) => {
        if (!active) return;
        setMachine(loaded);
        setStatus("");
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setLoadError(errorMessage(failure));
        setStatus("");
      });
    return () => {
      active = false;
      mounted.current = false;
      timers.current.forEach(clearTimeout);
    };
  }, []);

  async function retryLoad() {
    setLoadError("");
    setStatus("Warming up the machine…");
    try {
      const loaded = await loadMachine();
      if (!mounted.current) return;
      setMachine(loaded);
      setStatus("");
    } catch (failure) {
      if (!mounted.current) return;
      setLoadError(errorMessage(failure));
      setStatus("");
    }
  }

  const busy = phase !== "idle" && phase !== "revealed";

  async function pull() {
    if (!machine || busy || tokens < machine.cost) return;
    const still = prefersStill();
    skipped.current = false;
    setError("");
    setPrize(null);
    setPhase("shaking");
    setStatus("The machine is shaking…");
    let result: Awaited<ReturnType<typeof pullProfessor>>;
    try {
      [result] = await Promise.all([
        pullProfessor(machine.pity.guarantee),
        new Promise<void>((resolve) => {
          endShake.current = resolve;
          timers.current.push(
            window.setTimeout(resolve, still ? 0 : TIMING.shake),
          );
        }),
      ]);
    } catch (failure) {
      if (!mounted.current) return;
      setPhase("idle");
      setStatus("");
      setError(errorMessage(failure));
      return;
    }
    endShake.current = null;
    if (!mounted.current) return;
    const { professor } = result;
    setPrize(professor);
    finish.current = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      finish.current = null;
      setPhase("revealed");
      setMachine((current) => current && { ...current, pity: result.pity });
      onTokens(result.tokens);
      setStatus(
        `${professor.isNew ? "You recruited" : "Another copy of"} ${professor.name}, ${professor.rarity === "Epic" ? "an" : "a"} ${professor.rarity} professor!`,
      );
    };
    if (still || skipped.current) {
      finish.current();
      return;
    }
    const wobble =
      professor.rarity === "Legendary" ? TIMING.legendaryWobble : TIMING.wobble;
    const steps: [Phase, number][] = [
      ["dropping", 0],
      ["wobbling", TIMING.drop],
      ["opening", TIMING.drop + wobble],
    ];
    setStatus("A capsule drops out…");
    timers.current = [
      ...steps.map(([next, at]) => window.setTimeout(() => setPhase(next), at)),
      window.setTimeout(
        () => finish.current?.(),
        TIMING.drop + wobble + TIMING.open,
      ),
    ];
  }

  /** Skips the rest of the animation, or all of it if the server has not answered yet. */
  function skip() {
    skipped.current = true;
    endShake.current?.();
    finish.current?.();
  }

  const shown = phase !== "idle" && phase !== "shaking" ? prize : null;
  const short = machine !== null && tokens < machine.cost;
  const pity = machine?.pity;
  return (
    <section id="recruit-view" aria-labelledby="recruit-title">
      <button
        className="back-button"
        id="recruit-back"
        type="button"
        disabled={busy}
        onClick={onBack}
      >
        <span aria-hidden="true">←</span> Back to lobby
      </button>
      <p className="eyebrow">
        <span className="tiny-cross" aria-hidden="true">
          ✦
        </span>{" "}
        RECRUIT · GASHAPON
      </p>
      <h1 ref={title} id="recruit-title" tabIndex={-1}>
        Recruit a professor<span className="accent-dot">.</span>
      </h1>
      <p className="intro">
        Every pull brings a professor, locked in a cage that shows their
        rarity.
      </p>
      <div className="recruit-layout">
        <div
          className={`gacha-stage phase-${phase}${shown ? ` rarity-${shown.rarity.toLowerCase()}` : ""}`}
        >
          <div className="gacha-machine">
            <img className="machine-art" src={MACHINE_ART} alt="" />
            <GashaponGlobe shaking={phase === "shaking"} still={prefersStill()} />
          </div>
          {shown && (
            <div className="prize" aria-hidden="true">
              <div className="prize-rays" />
              <div className="prize-capsule">
                <img
                  className="capsule-half capsule-top"
                  src={CAPSULE_ART[CAPSULE_FOR[shown.rarity]]}
                  alt=""
                />
                <img
                  className="capsule-half capsule-bottom"
                  src={CAPSULE_ART[CAPSULE_FOR[shown.rarity]]}
                  alt=""
                />
              </div>
              <div className="prize-flash" />
              <div className="prize-caged">
                {professorArt(shown.id) && (
                  <img
                    className="caged-professor"
                    src={professorArt(shown.id)}
                    alt=""
                  />
                )}
                <img
                  className="caged-cage"
                  src={CAGE_ART[shown.cage.id]}
                  alt=""
                />
              </div>
            </div>
          )}
          {busy && (
            <button className="skip-button" type="button" onClick={skip}>
              Skip <span aria-hidden="true">»</span>
            </button>
          )}
        </div>
        <aside className="recruit-panel" aria-label="Recruitment">
          <dl className="wallet">
            <div>
              <dt>Your tokens</dt>
              <dd id="recruit-tokens">{numbers.format(tokens)}</dd>
            </div>
            <div>
              <dt>Each pull</dt>
              <dd>{machine ? numbers.format(machine.cost) : "–"}</dd>
            </div>
          </dl>
          {pity && (
            <div className="pity">
              <div className="pity-heading">
                <span id="pity-label">Epic or Legendary guarantee</span>
                <span className="pity-count">
                  {pity.count} / {pity.guarantee}
                </span>
              </div>
              <div
                className={`pity-bar${pity.guarantee - pity.count <= 1 ? " is-ready" : ""}`}
                role="progressbar"
                aria-labelledby="pity-label"
                aria-valuemin={0}
                aria-valuemax={pity.guarantee}
                aria-valuenow={pity.count}
                aria-valuetext={`${pity.count} of ${pity.guarantee} pulls`}
              >
                {Array.from({ length: pity.guarantee }, (_, index) => (
                  <span
                    key={index}
                    className={index < pity.count ? "is-filled" : undefined}
                  />
                ))}
              </div>
              <p className="pity-message">{pityMessage(pity)}</p>
            </div>
          )}
          <button
            className="primary-button"
            id="pull-button"
            type="button"
            disabled={!machine || busy || short}
            onClick={pull}
          >
            <span>
              {busy
                ? "Recruiting…"
                : `${phase === "revealed" ? "Pull again" : "Pull"} for ${machine ? numbers.format(machine.cost) : "…"} tokens`}
            </span>
            <span aria-hidden="true">✦</span>
          </button>
          {short && (
            <p className="recruit-hint">
              You need {numbers.format(machine.cost - tokens)} more{" "}
              {machine.cost - tokens === 1 ? "token" : "tokens"}.{" "}
              <button className="link-button" type="button" onClick={onQuestion}>
                Answer a pop quiz to earn some →
              </button>
            </p>
          )}
          <p className="session-status" id="recruit-status" role="status">
            {status}
          </p>
          <p
            className="form-message"
            role="alert"
            hidden={!error && !loadError}
          >
            {error || loadError}
          </p>
          {loadError && (
            <button className="secondary-button" type="button" onClick={retryLoad}>
              Try again <span aria-hidden="true">↻</span>
            </button>
          )}
          {shown && phase === "revealed" && (
            <article
              className={`prize-card rarity-${shown.rarity.toLowerCase()}`}
              aria-labelledby="prize-name"
            >
              <p className="eyebrow">
                {shown.isNew ? "★ NEW RECRUIT" : "DUPLICATE · +1 COPY"}
              </p>
              <h2 id="prize-name">{shown.name}</h2>
              <p className="prize-meta">
                <span className="rarity-badge">{shown.rarity}</span>{" "}
                {shown.department} · {shown.cage.name}
              </p>
              <dl className="prize-stats">
                {(
                  [
                    ["HP", shown.stats.health],
                    ["ATK", shown.stats.attack],
                    ["DEF", shown.stats.defense],
                    ["SPD", shown.stats.speed],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="prize-copies">
                Level {shown.level} · {shown.copies}{" "}
                {shown.copies === 1 ? "copy" : "copies"}
                {" · "}
                {shown.copies > shown.copiesToLevelUp
                  ? "ready to level up!"
                  : `${shown.copiesToLevelUp + 1 - shown.copies} more to level up`}
              </p>
            </article>
          )}
          {machine && (
            <div className="odds">
              <h2 className="eyebrow">WHAT’S INSIDE</h2>
              <ul>
                <li className="rarity-legendary">
                  <span className="rarity-badge">Legendary</span> Golden cage
                  <span>{percent.format(machine.odds.Legendary)}</span>
                </li>
                <li className="rarity-epic">
                  <span className="rarity-badge">Epic</span> Iron cage
                  <span>{percent.format(machine.odds.Epic)}</span>
                </li>
                <li className="rarity-rare">
                  <span className="rarity-badge">Rare / Common</span> Bronze
                  cage
                  <span>
                    {percent.format(machine.odds.Rare + machine.odds.Common)}
                  </span>
                </li>
              </ul>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
