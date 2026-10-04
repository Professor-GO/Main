/**
 * Runs the campus map: moves the player each frame, brings Legendary professors onto the map,
 * moves them around, and takes them away again, notices when the player meets one, and redraws
 * the screen.
 */
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  createImageCache,
  drawScene,
} from "../renderer";
import {
  SPAWNING,
  START,
  createWorldMap,
  directionFor,
  findEncounter,
  isChaser,
  moveSpawn,
  pickSpawnLevel,
  pickSpawnPoint,
  screenOf,
  walk,
} from "./world";
import type {
  Direction,
  MoveInput,
  Point,
  ProfessorStats,
  Screen,
  Spawn,
} from "./world";

/** A Legendary professor who can appear on the map. */
export type LegendaryProfessor = {
  id: string;
  name: string;
  department: string;
  // Their stats, which decide whether they chase the player. Without them they only wander.
  stats?: ProfessorStats;
};

/** What the page shows around the map: where the player is and where the professors are. */
export type WorldHud = {
  screen: Screen;
  // The screens that have a Legendary professor on them right now.
  spawnScreens: Screen[];
  // The name of a professor chasing the player, or null if nobody is.
  chasedBy: string | null;
};

/** Controls for a running map. */
export type WorldGame = {
  // Tells the game which movement keys are held.
  setInput(input: MoveInput): void;
  // Ends the current encounter: the professor slips away and the player can walk again.
  endEncounter(): void;
  // Stops the game loop for good.
  stop(): void;
};

/** What startWorldGame needs. */
export type WorldGameOptions = {
  canvas: HTMLCanvasElement;
  // The Legendary professors that can appear. With none, the map is just for walking.
  professors: readonly LegendaryProfessor[];
  // Called when the player changes screen or professors come or go.
  onHud(hud: WorldHud): void;
  // Called when the player walks up to a professor, with that professor's level. The player
  // stands still until endEncounter().
  onEncounter(professor: LegendaryProfessor, level: number): void;
  // Random numbers for spawning; defaults to Math.random.
  random?: () => number;
};

const NO_INPUT: MoveInput = {
  up: false,
  down: false,
  left: false,
  right: false,
};

/**
 * Starts the map on a canvas, with the player on their doorstep.
 * @param options - The canvas, the professors, and what to call when things change.
 * @returns Controls for the running map.
 */
export function startWorldGame(options: WorldGameOptions): WorldGame {
  const { canvas, professors, onHud, onEncounter } = options;
  const random = options.random ?? Math.random;
  const map = createWorldMap();
  const images = createImageCache();
  // Draws at the screen's real pixel density, so the map stays sharp on high-DPI displays.
  const density = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = CANVAS_WIDTH * density;
  canvas.height = CANVAS_HEIGHT * density;
  const context = canvas.getContext("2d");
  context?.setTransform(density, 0, 0, density, 0, 0);

  let input = NO_INPUT;
  let position: Point = START;
  let facing: Direction = "s";
  let walking = false;
  let spawns: (Spawn & { name: string })[] = [];
  let nextSpawnId = 1;
  let nextSpawnAt = SPAWNING.firstDelay;
  let meeting: number | null = null;
  let time = 0;
  let lastFrame = performance.now();
  let lastHud = "";
  let frame = 0;

  // Brings a new professor onto the map, or leaves them all where they are if it can't.
  function spawn(): void {
    nextSpawnAt =
      time +
      SPAWNING.minDelay +
      random() * (SPAWNING.maxDelay - SPAWNING.minDelay);
    if (!professors.length || spawns.length >= SPAWNING.maxActive) return;
    const point = pickSpawnPoint(map, position, random);
    if (!point) return;
    const professor = professors[Math.floor(random() * professors.length)];
    spawns.push({
      id: nextSpawnId++,
      professorId: professor.id,
      name: professor.name,
      level: pickSpawnLevel(random),
      ...point,
      leavesAt: time + SPAWNING.lifetime,
      chaser: isChaser(professor.stats),
      chasing: false,
      // Standing still until they choose a way to wander on the next frame.
      heading: { x: 0, y: 0 },
      turnAt: time,
    });
  }

  // Tells the page about the player's screen and the professors, but only when they change.
  function reportHud(): void {
    const hud: WorldHud = {
      screen: screenOf(position),
      spawnScreens: spawns.map((professor) => screenOf(professor)),
      chasedBy: spawns.find((professor) => professor.chasing)?.name ?? null,
    };
    const signature = JSON.stringify(hud);
    if (signature === lastHud) return;
    lastHud = signature;
    onHud(hud);
  }

  // One frame: move the player and the professors, check for a meeting, and draw.
  function tick(now: number): void {
    // A long gap (such as a hidden tab) counts as one short step, so nothing jumps.
    const seconds = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    time += seconds;

    const direction = meeting === null ? directionFor(input) : null;
    walking = direction !== null;
    if (direction) {
      facing = direction;
      position = walk(map, position, direction, seconds);
    }
    // Everyone holds still while the player is meeting a professor.
    if (meeting === null) {
      spawns = spawns.map((professor) => ({
        ...moveSpawn(map, professor, position, time, seconds, random),
        name: professor.name,
      }));
    }

    spawns = spawns.filter(
      (professor) => professor.leavesAt > time || professor.id === meeting,
    );
    if (time >= nextSpawnAt) spawn();
    if (meeting === null) {
      const met = findEncounter(position, spawns);
      if (met) {
        meeting = met.id;
        walking = false;
        const professor = professors.find(
          (candidate) => candidate.id === met.professorId,
        );
        if (professor) onEncounter(professor, met.level);
      }
    }
    reportHud();

    if (context) {
      const screen = screenOf(position);
      drawScene(
        context,
        {
          screen,
          props: map.propsOn(screen),
          spawns: spawns.filter((professor) => {
            const at = screenOf(professor);
            return at.col === screen.col && at.row === screen.row;
          }),
          player: { position, facing, walking },
          time,
        },
        images,
      );
    }
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);

  return {
    setInput(next) {
      input = next;
    },
    endEncounter() {
      spawns = spawns.filter((professor) => professor.id !== meeting);
      meeting = null;
    },
    stop() {
      cancelAnimationFrame(frame);
    },
  };
}
