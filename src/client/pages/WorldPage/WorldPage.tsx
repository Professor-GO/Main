import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { errorMessage } from "../../api/request";
import { loadInventory, loadWildProfessors } from "../../features/world/api";
import type { OwnedProfessor } from "../../features/world/api";
import { professorArt } from "../../features/world/art";
import { startWorldGame } from "../../features/world/Game Mechanics/game";
import type {
  Interaction,
  WildProfessor,
  WorldGame,
  WorldHud,
} from "../../features/world/Game Mechanics/game";
import {
  HOME_SCREEN,
  WORLD_SCREENS,
  isHome,
  isSchoolScreen,
  screenName,
} from "../../features/world/Game Mechanics/world";
import type { MoveInput } from "../../features/world/Game Mechanics/world";
import "./WorldPage.css";
import ActorLayer from "./ActorLayer";
import type { ActorLayerHandle } from "./ActorLayer";
import BattleEncounter from "./BattleEncounter";
import type { Fighter } from "./BattleEncounter";
import Gashapon from "./Gashapon";
import QuestionPage from "../QuestionPage/QuestionPage";

type WorldPageProps = {
  onBack: () => void;
  // Called with the player's balance when a gashapon pull changes it.
  onTokens?: (tokens: number) => void;
};

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
// What pressing F does, in words, for each thing the player can stand at.
const PROMPTS: Record<Interaction, string> = {
  "enter-home": "go into your home",
  "enter-school": "go into the school",
  exit: "go outside",
  machine: "use the gashapon machine",
  teacher: "take the teacher’s quiz",
};
const PLACE_NAMES = { campus: "", home: "Your home", school: "The school" };

/**
 * The open campus: a 5 × 5 map of screens, seen from above, that the player walks around,
 * starting at their house in the middle. The house and the school can be entered by pressing
 * F at their doors, and the school has a gashapon machine. Rare and Epic professors roam the
 * campus and the school; walking up to one opens an encounter card and a battle.
 */
export default function WorldPage({ onBack, onTokens }: WorldPageProps) {
  const title = useRef<HTMLHeadingElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const actors = useRef<ActorLayerHandle>(null);
  const meetButton = useRef<HTMLButtonElement>(null);
  const game = useRef<WorldGame | null>(null);
  const keys = useRef(new Set<string>());
  const pad = useRef<MoveInput>(NO_MOVE);
  const wild = useRef<Promise<WildProfessor[]> | null>(null);
  const [professors, setProfessors] = useState<WildProfessor[] | null>(null);
  const [notice, setNotice] = useState("");
  const [hud, setHud] = useState<WorldHud>({
    screen: HOME_SCREEN,
    spawnScreens: [],
    chasedBy: null,
  });
  const [encounter, setEncounter] = useState<WildProfessor | null>(null);
  const [fighting, setFighting] = useState(false);
  // The player's professors, loaded when they meet a wild one, and who they chose to send out.
  const [team, setTeam] = useState<OwnedProfessor[]>([]);
  const [fighter, setFighter] = useState<Fighter>(null);
  const [gashapon, setGashapon] = useState(false);
  const [quiz, setQuiz] = useState(false);

  useEffect(() => {
    document.title = "The open campus · Professor-Go";
    title.current?.focus();
    let active = true;
    wild.current ??= loadWildProfessors();
    wild.current
      .then((found) => {
        if (!active) return;
        setProfessors(found);
        if (!found.length) setNotice("No wild professors are roaming today.");
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
      onActors: (cast) => actors.current?.frame(cast),
    });
    game.current = running;
    return () => {
      running.stop();
      game.current = null;
    };
  }, [professors]);

  // Keyboard movement, and F to use a door or the gashapon machine. Arrow keys would
  // otherwise scroll the page, so they are held back.
  useEffect(() => {
    const held = keys.current;
    const down = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.code === "KeyF" && !event.repeat) {
        interact();
        return;
      }
      if (!(event.code in KEY_MOVES)) return;
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

  // When a wild professor appears, find out who the player could send out against them.
  useEffect(() => {
    if (!encounter) return;
    meetButton.current?.focus();
    let active = true;
    setTeam([]);
    setFighter(null);
    loadInventory()
      .then((owned) => {
        if (active) setTeam(owned.professors);
      })
      .catch(() => {
        // Without their professors, the player can still fight themselves.
      });
    return () => {
      active = false;
    };
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
  // Does what F does: goes through a door, opens the gashapon machine, or starts the
  // teacher's quiz. It only reads refs too, for the same reason.
  function interact() {
    const action = game.current?.interact();
    if (action !== "machine" && action !== "teacher") return;
    game.current?.setPaused(true);
    keys.current.clear();
    pad.current = NO_MOVE;
    pushInput();
    if (action === "machine") setGashapon(true);
    else setQuiz(true);
  }
  function closeOverlay() {
    game.current?.setPaused(false);
    setGashapon(false);
    setQuiz(false);
    canvas.current?.focus();
  }
  function leaveEncounter() {
    game.current?.endEncounter();
    keys.current.clear();
    pad.current = NO_MOVE;
    pushInput();
    setFighting(false);
    setEncounter(null);
    canvas.current?.focus();
  }

  const here = screenName(hud.screen);
  const place = hud.place ?? "campus";
  const art = encounter ? professorArt(encounter.id) : undefined;
  const overlay = !!encounter || gashapon || quiz;
  const roaming = hud.spawnScreens.length;
  return (
    <section id="world-view" aria-labelledby="world-title">
      <button
        className="back-button"
        type="button"
        onClick={onBack}
        disabled={fighting}
      >
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
            tabIndex={overlay ? -1 : 0}
            role="img"
            aria-label={
              place === "campus"
                ? `Campus map. You are on screen ${here}${isHome(hud.screen) ? ", at home" : ""}.`
                : `${PLACE_NAMES[place]}, seen from above.`
            }
          />
          <ActorLayer ref={actors} />
          {hud.prompt && !overlay && (
            <button className="world-prompt" type="button" onClick={interact}>
              Press <kbd>F</kbd> to {PROMPTS[hud.prompt]}
            </button>
          )}
          {gashapon && <Gashapon onClose={closeOverlay} onTokens={onTokens} />}
          {quiz && (
            <div className="quiz-overlay">
              <QuestionPage
                teacher
                onBack={closeOverlay}
                onTokens={(tokens) => onTokens?.(tokens)}
              />
            </div>
          )}
          {encounter && fighting && (
            <BattleEncounter
              professor={encounter}
              fighter={fighter}
              onLeave={leaveEncounter}
            />
          )}
          {encounter && !fighting && (
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
                <p className="eyebrow">★ A WILD PROFESSOR APPEARED</p>
                <h2 id="encounter-title">{encounter.name}</h2>
                <p className="encounter-meta">
                  {encounter.rarity} · {encounter.department}
                </p>
                <p className="encounter-note">
                  Challenge {encounter.name}. Watch for three timed coding
                  quizzes as their health drops.
                </p>
                <div
                  className="encounter-team"
                  role="group"
                  aria-label="Who to send out"
                >
                  {[null, ...team].map((member) => (
                    <button
                      key={member?.id ?? "you"}
                      type="button"
                      className="encounter-choice"
                      aria-pressed={
                        (fighter?.id ?? null) === (member?.id ?? null)
                      }
                      onClick={() =>
                        setFighter(
                          member ? { id: member.id, name: member.name } : null,
                        )
                      }
                    >
                      {member
                        ? `${member.name} · Lv ${member.level}`
                        : "Yourself"}
                    </button>
                  ))}
                </div>
                <button
                  ref={meetButton}
                  className="primary-button"
                  type="button"
                  onClick={() => setFighting(true)}
                >
                  <span>Fight professor</span>
                  <span aria-hidden="true">→</span>
                </button>
                <button
                  className="secondary-button"
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
              <span className="world-here">
                {place === "campus" ? `Screen ${here}` : PLACE_NAMES[place]}
              </span>
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
                  const hasWild = hud.spawnScreens.some(
                    (screen) =>
                      screen.col === cell.col && screen.row === cell.row,
                  );
                  return (
                    <span
                      key={index}
                      className={`minimap-cell${isHere ? " is-here" : ""}${hasWild ? " has-legendary" : ""}`}
                    >
                      {hasWild
                        ? "★"
                        : isHome(cell)
                          ? "⌂"
                          : isSchoolScreen(cell)
                            ? "✎"
                            : ""}
                    </span>
                  );
                },
              )}
            </div>
            <p className="world-status" role="status">
              {roaming
                ? `${roaming} wild ${roaming === 1 ? "professor is" : "professors are"} roaming: ${hud.spawnScreens.map(screenName).join(", ")}.`
              {hud.chasedBy
                ? `${hud.chasedBy} is chasing you! Outrun them or head home, where you're safe.`
                : hud.spawnScreens.length
                ? `${hud.spawnScreens.length} Legendary ${hud.spawnScreens.length === 1 ? "professor is" : "professors are"} roaming: ${hud.spawnScreens.map(screenName).join(", ")}.`
                : professors === null
                  ? "Looking for wild professors…"
                  : notice || "No wild professors right now. Keep exploring!"}
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
                  disabled={overlay}
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
            Press <kbd>F</kbd> at a door to go in or out. In the school (the ✎
            screen), press it at the gashapon machine to recruit, and at the
            teacher to take a quiz for 10 tokens a correct answer.
          </p>
        </aside>
      </div>
    </section>
  );
}
