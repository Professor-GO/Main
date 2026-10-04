import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import BattleEncounter from "../pages/WorldPage/BattleEncounter";
import type { BattleView } from "../features/world/battleApi";
import type { ArenaInput } from "../features/battle/arena";

// The props the page last gave the battle stage, so tests can see its controls and whether it runs.
const stage = vi.hoisted(() => ({
  props: null as null | {
    input: { current: ArenaInput };
    running: boolean;
  },
}));
// The real stage, with its frame loop held still so nothing lands by chance, plus two buttons
// that land a punch on demand, the way the arena reports one.
vi.mock("../features/battle/BattleStage", async (importOriginal) => {
  const { default: Stage } =
    await importOriginal<typeof import("../features/battle/BattleStage")>();
  return {
    default: (props: Parameters<typeof Stage>[0]) => {
      stage.props = props;
      return (
        <>
          <Stage {...props} running={false} />
          <button type="button" onClick={() => props.onLand("player")}>
            Test: land a punch
          </button>
          <button type="button" onClick={() => props.onLand("enemy")}>
            Test: take a punch
          </button>
        </>
      );
    },
  };
});

const professor = {
  id: "frank-wood",
  name: "Frank Wood",
  department: "Computer Science",
  rarity: "Epic",
  level: 37,
};
const base: BattleView = {
  id: "battle-1",
  professorId: professor.id,
  professorName: professor.name,
  version: 0,
  health: 50,
  maxHealth: 50,
  playerHealth: 100,
  playerMaxHealth: 100,
  status: "fighting",
  eventsTriggered: 0,
  eventNumber: null,
  question: null,
  feedback: null,
};
const question = () => ({
  id: "quiz-1",
  source: "gemini" as const,
  topic: "arrays",
  difficulty: "easy",
  question: "How many elements are in [1, 2, 3]?",
  choices: ["3", "2", "1", "4"],
  expiresAt: Date.now() + 10_000,
});
const reply = (data: BattleView) => Response.json(data);

/** Separates inventory loading from command mocks and keeps these workflow tests independent of animation duration. */
function stubBattleFetch(
  fetcher: (path: string, init?: RequestInit) => unknown,
  inventory: { professor: { id: string; name: string }; level: number }[] = [],
) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) =>
      path === "/api/inventory"
        ? Promise.resolve(Response.json({ inventory }))
        : fetcher(path, init),
    ),
  );
}
afterEach(() => {
  vi.useRealTimers();
});

test("a fight pauses for a generated question, then a wrong answer heals the professor and costs player HP", async () => {
  const waiting: BattleView = {
    ...base,
    version: 1,
    health: 35,
    status: "question",
    eventsTriggered: 1,
    eventNumber: 1,
  };
  const ready = { ...waiting, question: question() };
  const healed: BattleView = {
    ...base,
    version: 2,
    health: 44,
    playerHealth: 20,
    eventsTriggered: 1,
    feedback: {
      correct: false,
      timedOut: false,
      answerIndex: 0,
      explanation: "The array contains three elements.",
      healed: 9,
      healingPercent: 60,
      playerDamage: 80,
    },
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(base))
    .mockResolvedValueOnce(reply(waiting))
    .mockResolvedValueOnce(reply(ready))
    .mockResolvedValueOnce(reply(healed));
  stubBattleFetch(fetcher);
  render(
    <StrictMode>
      <BattleEncounter professor={professor} onLeave={vi.fn()} />
    </StrictMode>,
  );
  const punch = await screen.findByRole("button", { name: "Punch" });
  fireEvent.click(
    await screen.findByRole("button", { name: "Test: land a punch" }),
  );
  await screen.findByText(ready.question!.question);
  expect(punch).toBeDisabled();
  expect(stage.props?.running).toBe(false);
  expect(screen.getByText("10s left")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Pop quiz 1 / 3" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "B. 2" }));
  await screen.findByText(/recovered 9 HP/);
  expect(screen.getByText(/You lost 80 HP/)).toBeVisible();
  expect(
    screen.queryByRole("group", { name: "Answer choices" }),
  ).not.toBeInTheDocument();
  expect(punch).toBeEnabled();
  expect(fetcher.mock.calls[0][0]).toBe("/api/battle/start");
  // The level the professor rolled on the map goes to the server with the encounter.
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    professorId: "frank-wood",
    level: 37,
  });
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(JSON.parse(fetcher.mock.calls[3][1].body)).toMatchObject({
    kind: "answer",
    questionId: "quiz-1",
    selectedIndex: 1,
    version: 1,
  });
});

test("ten seconds elapsing submits one timeout and shows the healing result", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
  const ready: BattleView = {
    ...base,
    status: "question",
    version: 1,
    health: 35,
    eventsTriggered: 1,
    eventNumber: 1,
    question: question(),
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(ready))
    .mockResolvedValueOnce(
      reply({
        ...base,
        version: 2,
        health: 42,
        playerHealth: 20,
        eventsTriggered: 1,
        feedback: {
          correct: false,
          timedOut: true,
          answerIndex: 0,
          explanation: "Three elements.",
          healed: 7,
          healingPercent: 50,
          playerDamage: 80,
        },
      }),
    );
  stubBattleFetch(fetcher);
  render(<BattleEncounter professor={professor} onLeave={vi.fn()} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText(ready.question!.question)).toBeVisible();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9_900);
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByText("1s left")).toBeVisible();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(screen.getByText(/Time’s up!.*recovered 7 HP/)).toBeVisible();
  expect(screen.getByText(/You lost 80 HP/)).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    kind: "timeout",
    version: 1,
  });
});

test("lost answer replies allow only an explicit retry of the same choice and action id", async () => {
  const ready: BattleView = {
    ...base,
    status: "question",
    version: 1,
    health: 35,
    eventsTriggered: 1,
    eventNumber: 1,
    question: question(),
  };
  const done: BattleView = {
    ...base,
    version: 2,
    health: 35,
    eventsTriggered: 1,
    feedback: {
      correct: true,
      timedOut: false,
      answerIndex: 0,
      explanation: "Three elements.",
      healed: 0,
      healingPercent: 0,
    },
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(ready))
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValueOnce(reply(done));
  stubBattleFetch(fetcher);
  render(<BattleEncounter professor={professor} onLeave={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "A. 3" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "B. 2" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Correct! No healing penalty.");
  expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body);
});

test("winning allows returning to the paused overworld", async () => {
  stubBattleFetch(
    vi
      .fn()
      .mockResolvedValue(
        reply({ ...base, health: 0, status: "won", eventsTriggered: 3 }),
      ),
  );
  const leave = vi.fn();
  render(<BattleEncounter professor={professor} onLeave={leave} />);
  await waitFor(() =>
    expect(screen.getByText("You defeated the professor!")).toBeVisible(),
  );
  fireEvent.click(screen.getByRole("button", { name: /Keep exploring/ }));
  expect(leave).toHaveBeenCalledOnce();
});

test("the player can choose an owned professor's rig before their first attack", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(base))
    .mockResolvedValueOnce(
      reply({ ...base, version: 1, health: 43, playerHealth: 98 }),
    );
  stubBattleFetch(fetcher, [
    { professor: { id: "chao-liu", name: "Chao Liu" }, level: 2 },
    { professor: { id: "tor-aamodt", name: "Tor Aamodt" }, level: 1 },
  ]);
  render(<BattleEncounter professor={professor} onLeave={vi.fn()} />);
  const selector = await screen.findByRole("combobox", { name: "Battle as" });
  expect(
    screen.getByRole("img", { name: /Chao Liu facing Frank Wood/ }),
  ).toBeVisible();
  fireEvent.change(selector, { target: { value: "tor-aamodt" } });
  expect(
    screen.getByRole("img", { name: /Tor Aamodt facing Frank Wood/ }),
  ).toBeVisible();
  expect(document.querySelector('[data-side="player"] image')).toHaveAttribute(
    "href",
    expect.stringContaining("tor_aamodt_front.webp"),
  );
  expect(document.querySelector('[data-side="enemy"] image')).toHaveAttribute(
    "href",
    expect.stringContaining("frank_wood_front.webp"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Test: land a punch" }));
  await waitFor(() =>
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("img", { name: /Tor Aamodt facing Frank Wood/ }),
  ).toBeVisible();
});

test("punches are settled one at a time, in order, and the fight holds still while they are", async () => {
  let release: (value: Response) => void = () => {};
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(base))
    .mockImplementationOnce(
      () => new Promise<Response>((resolve) => (release = resolve)),
    )
    .mockResolvedValueOnce(
      reply({ ...base, version: 2, health: 43, playerHealth: 98 }),
    );
  stubBattleFetch(fetcher);
  render(<BattleEncounter professor={professor} onLeave={vi.fn()} />);
  await waitFor(() => expect(stage.props?.running).toBe(true));

  // The professor lands a punch, then the player lands one while the first is on its way.
  fireEvent.click(screen.getByRole("button", { name: "Test: take a punch" }));
  fireEvent.click(screen.getByRole("button", { name: "Test: land a punch" }));
  await waitFor(() => expect(stage.props?.running).toBe(false));
  expect(fetcher).toHaveBeenCalledTimes(2);
  // No "Updating battle" message flashes up for each punch.
  expect(screen.queryByText("Updating battle…")).not.toBeInTheDocument();

  await act(async () =>
    release(reply({ ...base, version: 1, playerHealth: 98 })),
  );
  await screen.findByText("43 / 50");
  expect(screen.getByText("98 / 100")).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    kind: "enemyAttack",
    version: 0,
  });
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({
    kind: "attack",
    version: 1,
  });
  await waitFor(() => expect(stage.props?.running).toBe(true));
});

test("punches still waiting when a quiz starts are dropped, not replayed after it", async () => {
  let release: (value: Response) => void = () => {};
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(base))
    .mockImplementationOnce(
      () => new Promise<Response>((resolve) => (release = resolve)),
    )
    .mockResolvedValue(
      reply({
        ...base,
        version: 1,
        health: 35,
        status: "question",
        eventsTriggered: 1,
        eventNumber: 1,
        question: question(),
      }),
    );
  stubBattleFetch(fetcher);
  render(<BattleEncounter professor={professor} onLeave={vi.fn()} />);
  await waitFor(() => expect(stage.props?.running).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Test: land a punch" }));
  fireEvent.click(screen.getByRole("button", { name: "Test: take a punch" }));
  await act(async () =>
    release(
      reply({
        ...base,
        version: 1,
        health: 35,
        status: "question",
        eventsTriggered: 1,
        eventNumber: 1,
      }),
    ),
  );
  await screen.findByText(/How many elements/);
  // Start, the punch, and the question: the professor's punch was never sent.
  expect(
    fetcher.mock.calls.filter(([path]) => String(path).endsWith("/action")),
  ).toHaveLength(1);
});

test("arrow keys, WASD, and J drive the fighter without moving the map behind", async () => {
  stubBattleFetch(vi.fn().mockResolvedValue(reply(base)));
  const behind = vi.fn();
  window.addEventListener("keydown", behind);
  render(<BattleEncounter professor={professor} onLeave={vi.fn()} />);
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(stage.props?.running).toBe(true));

  fireEvent.keyDown(dialog, { code: "ArrowRight", key: "ArrowRight" });
  fireEvent.keyDown(dialog, { code: "KeyW", key: "w" });
  fireEvent.keyDown(dialog, { code: "KeyJ", key: "j" });
  expect(stage.props?.input.current).toEqual({
    left: false,
    right: true,
    jump: true,
    punch: true,
  });
  fireEvent.keyUp(dialog, { code: "ArrowRight", key: "ArrowRight" });
  expect(stage.props?.input.current.right).toBe(false);
  expect(behind).not.toHaveBeenCalled();
  fireEvent.keyUp(dialog, { code: "KeyJ", key: "j" });
  fireEvent.keyDown(dialog, { code: "KeyF", key: "f" });
  expect(stage.props?.input.current.punch).toBe(false);
  window.removeEventListener("keydown", behind);

  // The on-screen buttons hold a control while pressed.
  const left = screen.getByRole("button", { name: "Move left" });
  fireEvent.pointerDown(left, { pointerId: 1 });
  expect(stage.props?.input.current.left).toBe(true);
  fireEvent.pointerUp(left, { pointerId: 1 });
  expect(stage.props?.input.current.left).toBe(false);
});

const summonRoster = [
  {
    id: "tor-aamodt",
    name: "Tor Aamodt",
    level: 1,
    defeated: false,
    stats: { health: 100, attack: 600, defense: 20, speed: 70 },
  },
  {
    id: "chao-liu",
    name: "Chao Liu",
    level: 2,
    defeated: false,
    stats: { health: 100, attack: 600, defense: 20, speed: 65 },
  },
];

test("a new fight waits for a summon, then offers only reserves after a knockout", async () => {
  const selecting: BattleView = {
    ...base,
    status: "summoning",
    playerHealth: 0,
    activeProfessorId: null,
    fighters: summonRoster,
  };
  const active: BattleView = {
    ...selecting,
    status: "fighting",
    version: 1,
    playerHealth: 100,
    activeProfessorId: "chao-liu",
  };
  const knocked: BattleView = {
    ...active,
    status: "summoning",
    version: 2,
    playerHealth: 0,
    health: 30,
    eventsTriggered: 1,
    fighters: summonRoster.map((fighter) => ({
      ...fighter,
      defeated: fighter.id === "chao-liu",
    })),
  };
  const replacement: BattleView = {
    ...knocked,
    version: 3,
    status: "fighting",
    playerHealth: 100,
    activeProfessorId: "tor-aamodt",
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(selecting))
    .mockResolvedValueOnce(reply(active))
    .mockResolvedValueOnce(reply(knocked))
    .mockResolvedValueOnce(reply(replacement))
    .mockResolvedValueOnce(
      reply({
        ...replacement,
        version: 4,
        status: "lost",
        playerHealth: 0,
        fighters: summonRoster.map((fighter) => ({
          ...fighter,
          defeated: true,
        })),
      }),
    );
  stubBattleFetch(fetcher);
  render(<BattleEncounter professor={professor} onLeave={vi.fn()} />);
  const selector = await screen.findByRole("combobox", {
    name: "Professor to summon",
  });
  expect(stage.props?.running).toBe(false);
  fireEvent.keyDown(screen.getByRole("dialog"), { code: "KeyJ", key: "j" });
  expect(stage.props?.input.current.punch).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Test: land a punch" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.change(selector, { target: { value: "chao-liu" } });
  fireEvent.click(screen.getByRole("button", { name: "Summon professor" }));
  await waitFor(() => expect(stage.props?.running).toBe(true));
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    kind: "summon",
    professorId: "chao-liu",
    version: 0,
  });
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog")).toHaveFocus();
  expect(
    screen.getByRole("img", { name: /Chao Liu facing Frank Wood/ }),
  ).toBeVisible();
  fireEvent.keyDown(screen.getByRole("dialog"), { code: "KeyJ", key: "j" });
  fireEvent.click(screen.getByRole("button", { name: "Test: take a punch" }));
  await screen.findByRole("heading", {
    name: "Your professor was defeated. Summon another!",
  });
  expect(stage.props?.running).toBe(false);
  expect(stage.props?.input.current.punch).toBe(false);
  expect(screen.getByRole("option", { name: /Tor Aamodt/ })).toBeVisible();
  expect(
    screen.queryByRole("option", { name: /Chao Liu/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Summon professor" }));
  await waitFor(() => expect(stage.props?.running).toBe(true));
  expect(screen.getByText("30 / 50")).toBeVisible();
  expect(
    screen.getByRole("img", { name: /Tor Aamodt facing Frank Wood/ }),
  ).toBeVisible();
  expect(JSON.parse(fetcher.mock.calls[3][1].body)).toMatchObject({
    kind: "summon",
    professorId: "tor-aamodt",
    version: 2,
  });
  fireEvent.click(screen.getByRole("button", { name: "Test: take a punch" }));
  await screen.findByText(
    "All your professors were defeated. Try again on your next encounter.",
  );
  expect(
    screen.queryByRole("button", { name: "Summon professor" }),
  ).not.toBeInTheDocument();
});

test("an empty collection cannot attack and can leave the encounter", async () => {
  const empty: BattleView = {
    ...base,
    status: "summoning",
    playerHealth: 0,
    activeProfessorId: null,
    fighters: [],
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(empty))
    .mockResolvedValueOnce(reply({ ...empty, version: 1, status: "fled" }));
  stubBattleFetch(fetcher);
  const leave = vi.fn();
  render(<BattleEncounter professor={professor} onLeave={leave} />);
  await screen.findByText(/No professors available/);
  expect(stage.props?.running).toBe(false);
  expect(
    screen.queryByRole("button", { name: "Summon professor" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Run away" }));
  await screen.findByText("You left the battle.");
  fireEvent.click(screen.getByRole("button", { name: /Keep exploring/ }));
  expect(leave).toHaveBeenCalledOnce();
});

test("a failed summon retries the same professor and action id", async () => {
  const selecting: BattleView = {
    ...base,
    status: "summoning",
    playerHealth: 0,
    activeProfessorId: null,
    fighters: summonRoster,
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(selecting))
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValueOnce(
      reply({
        ...selecting,
        version: 1,
        status: "fighting",
        activeProfessorId: "tor-aamodt",
        playerHealth: 100,
      }),
    );
  stubBattleFetch(fetcher);
  render(<BattleEncounter professor={professor} onLeave={vi.fn()} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Summon professor" }),
  );
  await screen.findByRole("alert");
  expect(screen.getByRole("combobox")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(stage.props?.running).toBe(true));
  expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body);
});
