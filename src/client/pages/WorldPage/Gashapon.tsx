import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/request";
import { loadGacha, pullGacha } from "../../features/world/api";
import type { Pull } from "../../features/world/api";
import {
  CAGE_ART,
  CAPSULE_ART,
  MACHINE_ART,
  professorArt,
} from "../../features/world/art";
import {
  createCapsules,
  shakeCapsules,
  stepCapsules,
} from "../../features/world/Game Mechanics/capsules";
import type {
  Capsule,
  Globe,
} from "../../features/world/Game Mechanics/capsules";
import { createImageCache } from "../../features/world/renderer";
import "./Gashapon.css";

// The canvas the machine is drawn on, in pixels before scaling for the screen's density.
const WIDTH = 576;
const HEIGHT = 440;
// Where the machine's picture (409 × 828) is drawn, and so where its globe and chute are.
const MACHINE = { x: 184, y: 14, width: 208, height: 421 };
const MACHINE_SCALE = MACHINE.height / 828;
const GLOBE: Globe = {
  x: MACHINE.x + 204 * MACHINE_SCALE,
  y: MACHINE.y + 232 * MACHINE_SCALE,
  radius: 172 * MACHINE_SCALE,
  capsuleRadius: 15,
};
const CHUTE = {
  x: MACHINE.x + 180 * MACHINE_SCALE,
  y: MACHINE.y + 700 * MACHINE_SCALE,
};
// Where a capsule rolls to and opens: in front of the machine, grown as if it rolled closer.
const REVEAL = { x: 470, y: 250, radius: 62 };
// The capsule pictures split along this line, as a share of their height from the top.
const SEAM = 0.58;
// How long each part of a pull lasts, in seconds. Later pulls of ten are quicker.
const TIMING = {
  shake: 1.3,
  quickShake: 0.35,
  roll: 0.9,
  open: 0.5,
  show: 1.1,
};

// A pull waiting to be played out. The first of a batch gets the long shake.
type Queued = { pull: Pull; first: boolean };
// What the canvas is animating: nothing, or one pull from the queue. `done` is set once the
// prize has been reported, while the last prize of a batch stays on show.
type Stage =
  | { kind: "idle" }
  | (Queued & { kind: "pull"; since: number; colour: number; done: boolean });

/** The cage a prize is shown in: gold for a Legendary professor, copper for the others. */
function cageFor(pull: Pull): string {
  if (pull.kind === "cage")
    return CAGE_ART[pull.cage.id] ?? CAGE_ART["bronze-cage"];
  return CAGE_ART[
    pull.professor.rarity === "Legendary" ? "golden-cage" : "bronze-cage"
  ];
}

/** A one-line description of a prize, for the status line and the list of ten. */
function describe(pull: Pull): string {
  return pull.kind === "cage"
    ? `${pull.cage.name} (you now have ${pull.quantity})`
    : `${pull.professor.name} · ${pull.professor.rarity}${pull.isNew ? " · new!" : ` · copy ${pull.copies}`}`;
}

/**
 * The gashapon machine in the school. Capsules tumble around inside its globe; a pull shakes
 * them, then a capsule rolls out, splits in half, and reveals the prize: a professor in a
 * cage, or a cage on its own. The player can make one pull or ten.
 */
export default function Gashapon({
  onClose,
  onTokens,
}: {
  onClose: () => void;
  // Called with the player's balance whenever a pull changes it.
  onTokens?: (tokens: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const queue = useRef<Queued[]>([]);
  const stage = useRef<Stage>({ kind: "idle" });
  const [info, setInfo] = useState<{ cost: number; tokens: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("Warming up the machine…");
  const [results, setResults] = useState<Pull[]>([]);
  const loaded = useRef<ReturnType<typeof loadGacha> | null>(null);
  // The animation loop reads these through a ref, so it never needs restarting.
  const finish = useRef<(pull: Pull, last: boolean) => void>(() => {});
  finish.current = (pull, last) => {
    setResults((shown) => [...shown, pull]);
    setMessage(describe(pull));
    if (last) setBusy(false);
  };

  useEffect(() => {
    title.current?.focus();
    let active = true;
    loaded.current ??= loadGacha();
    loaded.current
      .then((value) => {
        if (!active) return;
        setInfo(value);
        setMessage("");
        setBusy(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMessage(errorMessage(error));
        setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Draws the machine and runs the capsules, from when the machine opens until it closes.
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const density = Math.min(window.devicePixelRatio || 1, 2);
    element.width = WIDTH * density;
    element.height = HEIGHT * density;
    context.setTransform(density, 0, 0, density, 0, 0);
    const images = createImageCache();
    const capsules: Capsule[] = createCapsules(
      GLOBE,
      9,
      CAPSULE_ART.length,
      Math.random,
    );
    let time = 0;
    let last = performance.now();
    let nextJiggle = 1;
    let frame = 0;

    // Draws one capsule, whole or as two halves that have moved apart by `gap` pixels.
    const drawCapsule = (
      colour: number,
      x: number,
      y: number,
      radius: number,
      angle: number,
      gap = 0,
      alpha = 1,
    ) => {
      const image = images(CAPSULE_ART[colour % CAPSULE_ART.length]);
      context.save();
      context.globalAlpha = alpha;
      context.translate(x, y);
      context.rotate(angle);
      if (!image) {
        context.fillStyle = "#e5484d";
        context.beginPath();
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.fill();
      } else {
        const size = radius * 2;
        const cut = image.naturalHeight * SEAM;
        // The top half moves up and the bottom half down.
        context.drawImage(
          image,
          0,
          0,
          image.naturalWidth,
          cut,
          -radius,
          -radius - gap,
          size,
          size * SEAM,
        );
        context.drawImage(
          image,
          0,
          cut,
          image.naturalWidth,
          image.naturalHeight - cut,
          -radius,
          -radius + size * SEAM + gap,
          size,
          size * (1 - SEAM),
        );
      }
      context.restore();
    };

    // Draws a prize: a professor standing inside their cage, or a cage on its own.
    const drawPrize = (pull: Pull, grow: number) => {
      const height = 190 * grow;
      const cage = images(cageFor(pull));
      context.save();
      context.translate(REVEAL.x, REVEAL.y + 40);
      if (pull.kind === "professor") {
        const url = professorArt(pull.professor.id);
        const portrait = url ? images(url) : undefined;
        if (portrait) {
          const portraitHeight = height * 0.86;
          const portraitWidth =
            (portrait.naturalWidth / portrait.naturalHeight) * portraitHeight;
          context.drawImage(
            portrait,
            -portraitWidth / 2,
            -portraitHeight,
            portraitWidth,
            portraitHeight,
          );
        }
      }
      if (cage) {
        const cageWidth = (cage.naturalWidth / cage.naturalHeight) * height;
        context.drawImage(cage, -cageWidth / 2, -height, cageWidth, height);
      }
      context.restore();
    };

    const tick = (now: number) => {
      const seconds = Math.min((now - last) / 1000, 0.05);
      last = now;
      time += seconds;
      let current = stage.current;
      // Start the next pull in the queue once the last one has been shown.
      if (current.kind === "idle" && queue.current.length) {
        current = stage.current = {
          kind: "pull",
          ...queue.current.shift()!,
          since: time,
          colour: Math.floor(Math.random() * CAPSULE_ART.length),
          done: false,
        };
      }
      const elapsed = current.kind === "pull" ? time - current.since : 0;
      const shakeTime =
        current.kind === "pull"
          ? current.first
            ? TIMING.shake
            : TIMING.quickShake
          : 0;
      const shaking = current.kind === "pull" && elapsed < shakeTime;
      // The capsules are tossed about during a pull, and stir a little now and then otherwise.
      if (shaking) shakeCapsules(capsules, 140, Math.random);
      else if (time >= nextJiggle) {
        nextJiggle = time + 1.5 + Math.random() * 2.5;
        shakeCapsules(capsules, 260, Math.random);
      }
      stepCapsules(capsules, GLOBE, seconds);

      context.clearRect(0, 0, WIDTH, HEIGHT);
      const machine = images(MACHINE_ART);
      const rattle = shaking ? Math.sin(time * 70) * 3 : 0;
      context.save();
      context.translate(rattle, 0);
      if (machine)
        context.drawImage(
          machine,
          MACHINE.x,
          MACHINE.y,
          MACHINE.width,
          MACHINE.height,
        );
      for (const capsule of capsules)
        drawCapsule(
          capsule.colour,
          capsule.x,
          capsule.y,
          GLOBE.capsuleRadius,
          capsule.angle,
        );
      context.restore();

      if (current.kind === "pull" && !shaking) {
        const rolling = elapsed - shakeTime;
        if (rolling < TIMING.roll) {
          // The capsule drops out of the chute and rolls towards the player, growing as it comes.
          const progress = rolling / TIMING.roll;
          const eased = 1 - (1 - progress) ** 2;
          const radius =
            GLOBE.capsuleRadius + (REVEAL.radius - GLOBE.capsuleRadius) * eased;
          drawCapsule(
            current.colour,
            CHUTE.x + (REVEAL.x - CHUTE.x) * eased,
            CHUTE.y +
              (REVEAL.y - CHUTE.y) * eased -
              Math.sin(progress * Math.PI) * 40,
            radius,
            eased * Math.PI * 4,
          );
        } else {
          // It splits in half; the halves drift apart and fade as the prize grows out of it.
          const opening = Math.min(1, (rolling - TIMING.roll) / TIMING.open);
          drawPrize(current.pull, 0.3 + 0.7 * opening);
          if (opening < 1)
            drawCapsule(
              current.colour,
              REVEAL.x,
              REVEAL.y,
              REVEAL.radius,
              0,
              opening * 70,
              1 - opening,
            );
          if (
            !current.done &&
            rolling >= TIMING.roll + TIMING.open + TIMING.show
          ) {
            const last = queue.current.length === 0;
            finish.current(current.pull, last);
            // The last prize stays on show until the next pull or the machine is closed.
            stage.current = last
              ? { ...current, done: true }
              : { kind: "idle" };
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // The loop reads the queue and the current pull through refs, so it runs once.
  }, []);

  /** Pays for one pull or ten, then lets the machine play them out one by one. */
  async function pull(count: 1 | 10) {
    if (busy) return;
    setBusy(true);
    setResults([]);
    setMessage("The machine rattles…");
    try {
      const made = await pullGacha(count);
      setInfo((current) =>
        current ? { ...current, tokens: made.tokens } : current,
      );
      onTokens?.(made.tokens);
      stage.current = { kind: "idle" };
      queue.current = made.pulls.map((pull, index) => ({
        pull,
        first: index === 0,
      }));
    } catch (error) {
      setMessage(errorMessage(error));
      setBusy(false);
    }
  }

  return (
    <div className="gashapon-overlay">
      <div
        className="gashapon-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gashapon-title"
      >
        <div className="gashapon-heading">
          <h2 id="gashapon-title" ref={title} tabIndex={-1}>
            Gashapon machine
          </h2>
          <span className="gashapon-tokens">
            {info ? `${info.tokens} tokens` : ""}
          </span>
        </div>
        <canvas
          ref={canvas}
          className="gashapon-canvas"
          role="img"
          aria-label="A gashapon machine with capsules tumbling inside it."
        />
        <p className="gashapon-status" role="status">
          {message}
        </p>
        {results.length > 1 && (
          <ol className="gashapon-results" aria-label="What you pulled">
            {results.map((result, index) => (
              <li
                key={index}
                className={result.kind === "professor" ? "is-professor" : ""}
              >
                {describe(result)}
              </li>
            ))}
          </ol>
        )}
        <div className="gashapon-actions">
          <button
            className="primary-button"
            type="button"
            disabled={busy || !info}
            onClick={() => void pull(1)}
          >
            Pull 1{info ? ` · ${info.cost} tokens` : ""}
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={busy || !info}
            onClick={() => void pull(10)}
          >
            Pull 10{info ? ` · ${info.cost * 10} tokens` : ""}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
