/**
 * Runs the world: moves the player each frame, on the campus or inside a building; brings wild
 * professors onto the map and into the school, lets them wander, and takes them away again;
 * notices when the player meets one or stands somewhere they can press F; and redraws the screen.
 */
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  TILE,
  createImageCache,
  drawRoom,
  drawScene,
} from "../renderer";
import {
  ROOMS,
  ROOM_ENTRY,
  isRoomBlocked,
  pickRoomSpawnPoint,
  roomUseAt,
  walkRoom,
} from "./rooms";
import type { Place } from "./rooms";
import {
  ENCOUNTER_RADIUS,
  HOME_SCREEN,
  SCHOOL_SCREEN,
  SCREEN_TILES,
  SPAWNING,
  START,
  createWorldMap,
  directionFor,
  doorAt,
  doorstep,
  isBlocked,
  isHome,
  pickSpawnPoint,
  screenOf,
  walk,
  wrap,
  wrappedDistance,
} from "./world";
import type { Direction, MoveInput, Point, Screen, Spawn } from "./world";

/** A wild professor who can appear on the map: only Rare and Epic professors roam. */
export type WildProfessor = {
  id: string;
  name: string;
  department: string;
  rarity: string;
};

/** Something the player can do by pressing F where they stand. */
export type Interaction =
  | "enter-home"
  | "enter-school"
  | "exit"
  | "machine"
  | "teacher";

/** What the page shows around the map: where the player is and where the professors are. */
export type WorldHud = {
  screen: Screen;
  // The screens that have a wild professor on them right now.
  spawnScreens: Screen[];
  // Where the player is: on the campus or inside a building. Missing means the campus.
  place?: Place;
  // What pressing F would do where the player stands, if anything.
  prompt?: Interaction | null;
};

/** One stickman to show over the canvas this frame: the player, or a wild professor in view. */
export type ActorView = {
  key: string;
  // Whose head and body to draw: a professor's id, or "main" for the player.
  look: string;
  // Where their feet are on the canvas, in pixels.
  x: number;
  y: number;
  walking: boolean;
  facing: Direction;
};

/** Controls for a running map. */
export type WorldGame = {
  // Tells the game which movement keys are held.
  setInput(input: MoveInput): void;
  // Does whatever F does where the player stands: goes through a door, or reports that the
  // gashapon machine or the teacher is in reach so the page can open it.
  interact(): Interaction | null;
  // Freezes the player while the page shows something over the map, such as the gashapon machine.
  setPaused(paused: boolean): void;
  // Ends the current encounter: the professor slips away and the player can walk again.
  endEncounter(): void;
  // Stops the game loop for good.
  stop(): void;
};

/** What startWorldGame needs. */
export type WorldGameOptions = {
  canvas: HTMLCanvasElement;
  // The wild professors that can appear. With none, the map is just for walking.
  professors: readonly WildProfessor[];
  // Called when the player changes screen or place, professors come or go, or the F prompt changes.
  onHud(hud: WorldHud): void;
  // Called when the player walks up to a professor. The player stands still until endEncounter().
  onEncounter(professor: WildProfessor): void;
  // Called every frame with the stickmen in view, for the layer drawn over the canvas.
  onActors?(actors: readonly ActorView[]): void;
  // Random numbers for spawning; defaults to Math.random.
  random?: () => number;
};

// A wild professor on the map or in the school, ambling towards a nearby spot.
type Wild = Spawn & {
  name: string;
  place: "campus" | "school";
  targetX: number;
  targetY: number;
  // When they next pick somewhere to amble to, in seconds on the game clock.
  thinkAt: number;
  walking: boolean;
  facing: Direction;
};

const NO_INPUT: MoveInput = {
  up: false,
  down: false,
  left: false,
  right: false,
};
// How fast wild professors amble, in tiles a second, and how often one appears in the school
// rather than on the campus.
const WILD_SPEED = 1.1;
const SCHOOL_SPAWN_CHANCE = 0.35;

/**
 * Starts the map on a canvas, with the player on their doorstep.
 * @param options - The canvas, the professors, and what to call when things change.
 * @returns Controls for the running map.
 */
export function startWorldGame(options: WorldGameOptions): WorldGame {
  const { canvas, professors, onHud, onEncounter, onActors } = options;
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
  let place: Place = "campus";
  // On the campus this is in world tiles; inside a building, in tiles from the room's corner.
  let position: Point = START;
  let facing: Direction = "s";
  let walking = false;
  let paused = false;
  let wilds: Wild[] = [];
  let nextSpawnId = 1;
  let nextSpawnAt = SPAWNING.firstDelay;
  let meeting: number | null = null;
  let prompt: Interaction | null = null;
  let time = 0;
  let lastFrame = performance.now();
  let lastHud = "";
  let frame = 0;

  // Brings a new professor onto the campus or into the school, if there is room for one.
  function spawn(): void {
    nextSpawnAt =
      time +
      SPAWNING.minDelay +
      random() * (SPAWNING.maxDelay - SPAWNING.minDelay);
    if (!professors.length || wilds.length >= SPAWNING.maxActive) return;
    // The school holds one professor at a time; nobody ever appears in the player's home.
    const inSchool =
      !wilds.some((wild) => wild.place === "school") &&
      random() < SCHOOL_SPAWN_CHANCE;
    const point = inSchool
      ? pickRoomSpawnPoint(
          ROOMS.school,
          place === "school" ? position : null,
          random,
        )
      : pickSpawnPoint(
          map,
          place === "campus" ? position : doorstep(place),
          random,
        );
    if (!point) return;
    const professor = professors[Math.floor(random() * professors.length)];
    wilds.push({
      id: nextSpawnId++,
      professorId: professor.id,
      name: professor.name,
      place: inSchool ? "school" : "campus",
      ...point,
      targetX: point.x,
      targetY: point.y,
      thinkAt: time + 1 + random() * 2,
      walking: false,
      facing: "s",
      leavesAt: time + SPAWNING.lifetime,
    });
  }

  // Lets each wild professor roam: they walk to a spot some way off, pause, and pick another.
  // On the campus they cross from screen to screen (and around the edges of the world), but
  // keep off the home screen; in the school they stay in the room. They avoid scenery, and
  // stand still while being met.
  function wander(seconds: number): void {
    for (const wild of wilds) {
      wild.walking = false;
      if (wild.id === meeting) continue;
      if (time >= wild.thinkAt) {
        wild.thinkAt = time + 2 + random() * 4;
        // Now and then they stay where they are for a moment.
        const stay = random() < 0.3;
        const reach = wild.place === "school" ? 5 : 12;
        wild.targetX = stay ? wild.x : wild.x + (random() - 0.5) * reach;
        wild.targetY = stay ? wild.y : wild.y + (random() - 0.5) * reach;
      }
      const x = wild.targetX - wild.x;
      const y = wild.targetY - wild.y;
      const length = Math.hypot(x, y);
      if (length < 0.05) continue;
      const step = {
        x: wild.x + (x / length) * WILD_SPEED * seconds,
        y: wild.y + (y / length) * WILD_SPEED * seconds,
      };
      // On the campus, walking off the edge of the world comes back on the other side.
      const next =
        wild.place === "school" ? step : { x: wrap(step.x), y: wrap(step.y) };
      const blocked =
        wild.place === "school"
          ? isRoomBlocked(ROOMS.school, next, 0.5)
          : isBlocked(map, next, 0.5) || isHome(screenOf(next));
      if (blocked) {
        wild.targetX = wild.x;
        wild.targetY = wild.y;
        continue;
      }
      // If they wrapped around, their target moves with them.
      wild.targetX += next.x - step.x;
      wild.targetY += next.y - step.y;
      wild.x = next.x;
      wild.y = next.y;
      wild.walking = true;
      wild.facing =
        Math.abs(x) > Math.abs(y) ? (x > 0 ? "e" : "w") : y > 0 ? "s" : "n";
    }
  }

  // The screen shown in the page's map: the player's, or their building's while indoors.
  function currentScreen(): Screen {
    return place === "campus"
      ? screenOf(position)
      : place === "home"
        ? HOME_SCREEN
        : SCHOOL_SCREEN;
  }

  // Tells the page about the player's place and the professors, but only when they change.
  function reportHud(): void {
    const hud: WorldHud = {
      screen: currentScreen(),
      spawnScreens: wilds.map((wild) =>
        wild.place === "school" ? SCHOOL_SCREEN : screenOf(wild),
      ),
      place,
      prompt,
    };
    const signature = JSON.stringify(hud);
    if (signature === lastHud) return;
    lastHud = signature;
    onHud(hud);
  }

  // One frame: move, update the professors, check for a meeting, and draw.
  function tick(now: number): void {
    // A long gap (such as a hidden tab) counts as one short step, so nothing jumps.
    const seconds = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    time += seconds;

    const direction = meeting === null && !paused ? directionFor(input) : null;
    walking = direction !== null;
    if (direction) {
      facing = direction;
      position =
        place === "campus"
          ? walk(map, position, direction, seconds)
          : walkRoom(ROOMS[place], position, direction, seconds);
    }

    wilds = wilds.filter((wild) => wild.leavesAt > time || wild.id === meeting);
    if (time >= nextSpawnAt) spawn();
    wander(seconds);
    // The wild professors in the same place as the player.
    const here = wilds.filter((wild) =>
      place === "campus" ? wild.place === "campus" : wild.place === place,
    );
    if (meeting === null && !paused) {
      const met = here.find(
        (wild) => wrappedDistance(position, wild) < ENCOUNTER_RADIUS,
      );
      if (met) {
        meeting = met.id;
        walking = false;
        const professor = professors.find(
          (candidate) => candidate.id === met.professorId,
        );
        if (professor) onEncounter(professor);
      }
    }
    const use =
      place === "campus" ? doorAt(position) : roomUseAt(ROOMS[place], position);
    prompt =
      meeting !== null || !use
        ? null
        : use === "home"
          ? "enter-home"
          : use === "school"
            ? "enter-school"
            : use;
    reportHud();

    // What is in view: on the campus, the player's screen; indoors, the whole room.
    const screen = currentScreen();
    const left = place === "campus" ? screen.col * SCREEN_TILES : 0;
    const top = place === "campus" ? screen.row * SCREEN_TILES : 0;
    const visible = here.filter((wild) => {
      if (place !== "campus") return true;
      const at = screenOf(wild);
      return at.col === screen.col && at.row === screen.row;
    });
    if (context) {
      if (place === "campus")
        drawScene(
          context,
          { screen, props: map.propsOn(screen), spawns: visible, time },
          images,
        );
      else
        drawRoom(
          context,
          { room: ROOMS[place], spawns: visible, time },
          images,
        );
    }
    const npc = place === "campus" ? null : ROOMS[place].npc;
    onActors?.([
      {
        key: "player",
        look: "main",
        x: (position.x - left) * TILE,
        y: (position.y - top) * TILE,
        walking,
        facing,
      },
      ...visible.map((wild) => ({
        key: `wild-${wild.id}`,
        look: wild.professorId,
        x: (wild.x - left) * TILE,
        y: (wild.y - top) * TILE,
        walking: wild.walking,
        facing: wild.facing,
      })),
      // Whoever stands in the room, such as the teacher in the school.
      ...(npc
        ? [
            {
              key: `npc-${place}`,
              look: npc.look,
              x: npc.x * TILE,
              y: npc.y * TILE,
              walking: false,
              facing: "s" as const,
            },
          ]
        : []),
    ]);
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);

  return {
    setInput(next) {
      input = next;
    },
    interact() {
      const action = prompt;
      if (action === "enter-home" || action === "enter-school") {
        place = action === "enter-home" ? "home" : "school";
        position = ROOM_ENTRY;
        facing = "n";
      } else if (action === "exit" && place !== "campus") {
        position = doorstep(place);
        place = "campus";
        facing = "s";
      }
      return action;
    },
    setPaused(next) {
      paused = next;
    },
    endEncounter() {
      wilds = wilds.filter((wild) => wild.id !== meeting);
      meeting = null;
    },
    stop() {
      cancelAnimationFrame(frame);
    },
  };
}
