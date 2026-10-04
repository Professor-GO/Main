import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { errorMessage } from "../../api/request";
import { loadLegendaries } from "../../features/world/api";
import { professorArt } from "../../features/world/art";
import { startWorldGame } from "../../features/world/Game Mechanics/game";
import type {
  LegendaryProfessor,
  WorldGame,
  WorldHud,
} from "../../features/world/Game Mechanics/game";
import {
  HOME_SCREEN,
  WORLD_SCREENS,
  isHome,
  screenName,
} from "../../features/world/Game Mechanics/world";
import type { MoveInput } from "../../features/world/Game Mechanics/world";
import "./WorldPage.css";

type WorldPageProps = { onBack: () => void };

// Which movement each key gives. Arrow keys and WASD both work.
const KEY_MOVES: Record<string, keyof MoveInput> = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
};
// The on-screen pad's eight buttons, in reading order with a gap in the middle.
const PAD_BUTTONS: ({
  label: string;
  arrow: string;
  moves: (keyof MoveInput)[];
} | null)[] = [
  { label: "Up and left", arrow: "↖", moves: ["up", "left"] },
  { label: "Up", arrow: "↑", moves: ["up"] },
  { label: "Up and right", arrow: "↗", moves: ["up", "right"] },
  { label: "Left", arrow: "←", moves: ["left"] },
  null,
  { label: "Right", arrow: "→", moves: ["right"] },
  { label: "Down and left", arrow: "↙", moves: ["down", "left"] },
  { label: "Down", arrow: "↓", moves: ["down"] },
  { label: "Down and right", arrow: "↘", moves: ["down", "right"] },
];
const NO_MOVE: MoveInput = {
  up: false,
  down: false,
  left: false,
  right: false,
};

/**
 * The open campus: a 5 × 5 map of screens, seen from above, that the player walks around, starting at their
 * house in the middle. Legendary professors appear at random; walking up to one opens an
 * encounter card. Battles are not built yet.
 */
export default function WorldPage({ onBack }: WorldPageProps) {
  const title = useRef<HTMLHeadingElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const meetButton = useRef<HTMLButtonElement>(null);
  const game = useRef<WorldGame | null>(null);
  const keys = useRef(new Set<string>());
  const pad = useRef<MoveInput>(NO_MOVE);
  const legendaries = useRef<Promise<LegendaryProfessor[]> | null>(null);
  const [professors, setProfessors] = useState<LegendaryProfessor[] | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const [hud, setHud] = useState<WorldHud>({
    screen: HOME_SCREEN,
    spawnScreens: [],
  });
  const [encounter, setEncounter] = useState<LegendaryProfessor | null>(null);

  useEffect(() => {
    document.title = "The open campus · Professor-Go";
    title.current?.focus();
    let active = true;
    legendaries.current ??= loadLegendaries();
    legendaries.current
      .then((found) => {
        if (!active) return;
        setProfessors(found);
        if (!found.length)
          setNotice("No Legendary professors are roaming today.");
      })
      .catch((error: unknown) => {
        if (!active) return;
        // The map still works without professors; there is just no one to meet.
        setProfessors([]);
        setNotice(`${errorMessage(error)} You can still explore.`);
      });
    return () => {
      active = false;
    };
  }, []);

  // Starts the map once the professors are known, and stops it when the page closes.
  useEffect(() => {
    if (!professors || !canvas.current) return;
    const running = startWorldGame({
      canvas: canvas.current,
      professors,
      onHud: setHud,
      onEncounter: setEncounter,
    });
    game.current = running;
    return () => {
      running.stop();
      game.current = null;
    };
  }, [professors]);

  // Keyboard movement. Arrow keys would otherwise scroll the page, so they are held back.
  useEffect(() => {
    const held = keys.current;
    const down = (event: KeyboardEvent) => {
      if (
        !(event.code in KEY_MOVES) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      event.preventDefault();
      held.add(event.code);
      pushInput();
    };
    const up = (event: KeyboardEvent) => {
      if (held.delete(event.code)) pushInput();
    };
    // Lets go of everything when the window loses focus, so the player doesn't walk on forever.
    const release = () => {
      held.clear();
      pad.current = NO_MOVE;
      pushInput();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, []);

  useEffect(() => {
    if (encounter) meetButton.current?.focus();
  }, [encounter]);

  // Holds a direction on the on-screen pad while it is pressed.
  function press(moves: (keyof MoveInput)[], event: ReactPointerEvent) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pad.current = { ...NO_MOVE };
    for (const move of moves) pad.current[move] = true;
    pushInput();
  }
  function releasePad() {
    pad.current = NO_MOVE;
    pushInput();
  }
  // Sends the keys and pad buttons held right now to the game. It only reads refs, so the
  // keyboard listeners can call it without being re-added.
  function pushInput() {
    const input = { ...pad.current };
    for (const code of keys.current) input[KEY_MOVES[code]] = true;
    game.current?.setInput(input);
  }
  function leaveEncounter() {
    game.current?.endEncounter();
    setEncounter(null);
    canvas.current?.focus();
  }

  const here = screenName(hud.screen);
  const art = encounter ? professorArt(encounter.id) : undefined;
  return (
    <section id="world-view" aria-labelledby="world-title">
      <button className="back-button" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Back to lobby
      </button>
      <p className="eyebrow">
        <span className="tiny-cross" aria-hidden="true">
          ✦
        </span>{" "}
        EXPLORE · THE OPEN CAMPUS
      </p>
      <h1 ref={title} id="world-title" tabIndex={-1}>
        The open campus<span className="accent-dot">.</span>
      </h1>
      <div className="world-layout">
        <div className="world-stage">
          <canvas
            ref={canvas}
            className="world-canvas"
            tabIndex={0}
            role="img"
            aria-label={`Campus map. You are on screen ${here}${isHome(hud.screen) ? ", at home" : ""}.`}
          />
          {encounter && (
            <div
              className="encounter-card"
              role="dialog"
              aria-labelledby="encounter-title"
            >
              {art && (
                <img
                  className="encounter-portrait"
                  src={art}
                  alt={encounter.name}
                />
              )}
              <div>
                <p className="eyebrow">★ A LEGENDARY PROFESSOR APPEARED</p>
                <h2 id="encounter-title">{encounter.name}</h2>
                <p className="encounter-meta">
                  Legendary · {encounter.department}
                </p>
                <p className="encounter-note">
                  Battles are coming soon. For now, {encounter.name} gives you a
                  knowing nod and slips away.
                </p>
                <button
                  ref={meetButton}
                  className="primary-button"
                  type="button"
                  onClick={leaveEncounter}
                >
                  <span>Keep exploring</span>
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          )}
        </div>
        <aside className="world-side" aria-label="Map and controls">
          <div className="world-panel">
            <div className="world-panel-heading">
              <span className="eyebrow">CAMPUS MAP</span>
              <span className="world-here">Screen {here}</span>
            </div>
            <div className="minimap" aria-hidden="true">
              {Array.from(
                { length: WORLD_SCREENS * WORLD_SCREENS },
                (_, index) => {
                  const cell = {
                    col: index % WORLD_SCREENS,
                    row: Math.floor(index / WORLD_SCREENS),
                  };
                  const isHere =
                    cell.col === hud.screen.col && cell.row === hud.screen.row;
                  const hasLegendary = hud.spawnScreens.some(
                    (screen) =>
                      screen.col === cell.col && screen.row === cell.row,
                  );
                  return (
                    <span
                      key={index}
                      className={`minimap-cell${isHere ? " is-here" : ""}${hasLegendary ? " has-legendary" : ""}`}
                    >
                      {hasLegendary ? "★" : isHome(cell) ? "⌂" : ""}
                    </span>
                  );
                },
              )}
            </div>
            <p className="world-status" role="status">
              {hud.spawnScreens.length
                ? `${hud.spawnScreens.length} Legendary ${hud.spawnScreens.length === 1 ? "professor is" : "professors are"} roaming: ${hud.spawnScreens.map(screenName).join(", ")}.`
                : professors === null
                  ? "Looking for Legendary professors…"
                  : notice ||
                    "No Legendary professors right now. Keep exploring!"}
            </p>
          </div>
          <div className="dpad" role="group" aria-label="Move">
            {PAD_BUTTONS.map((button, index) =>
              button ? (
                <button
                  key={index}
                  type="button"
                  className="dpad-button"
                  aria-label={button.label}
                  onPointerDown={(event) => press(button.moves, event)}
                  onPointerUp={releasePad}
                  onPointerCancel={releasePad}
                  onLostPointerCapture={releasePad}
                >
                  {button.arrow}
                </button>
              ) : (
                <span key={index} className="dpad-centre" aria-hidden="true" />
              ),
            )}
          </div>
          <p className="world-help">
            Walk with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or the
            arrow keys. Hold two keys to walk diagonally. Walk off the edge of a
            screen to reach the next one; the campus wraps around at its edges.
          </p>
        </aside>
      </div>
    </section>
  );
}
