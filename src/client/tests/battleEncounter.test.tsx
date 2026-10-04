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

const professor = {
  id: "frank-wood",
  name: "Frank Wood",
  department: "Computer Science",
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
afterEach(() => {
  vi.useRealTimers();
});

test("a fight pauses for a generated question, then a wrong answer heals the professor", async () => {
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
    eventsTriggered: 1,
    feedback: {
      correct: false,
      timedOut: false,
      answerIndex: 0,
      explanation: "The array contains three elements.",
      healed: 9,
      healingPercent: 60,
    },
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(base))
    .mockResolvedValueOnce(reply(waiting))
    .mockResolvedValueOnce(reply(ready))
    .mockResolvedValueOnce(reply(healed));
  vi.stubGlobal("fetch", fetcher);
  render(
    <StrictMode>
      <BattleEncounter professor={professor} onLeave={vi.fn()} />
    </StrictMode>,
  );
  const attack = await screen.findByRole("button", { name: "Attack" });
  fireEvent.click(attack);
  await screen.findByText(ready.question!.question);
  expect(attack).toBeDisabled();
  expect(screen.getByText("10s left")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Pop quiz 1 / 3" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "B. 2" }));
  await screen.findByText(/recovered 9 HP/);
  expect(
    screen.queryByRole("group", { name: "Answer choices" }),
  ).not.toBeInTheDocument();
  expect(attack).toBeEnabled();
  expect(fetcher.mock.calls[0][0]).toBe("/api/battle/start");
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
        eventsTriggered: 1,
        feedback: {
          correct: false,
          timedOut: true,
          answerIndex: 0,
          explanation: "Three elements.",
          healed: 7,
          healingPercent: 50,
        },
      }),
    );
  vi.stubGlobal("fetch", fetcher);
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
  vi.stubGlobal("fetch", fetcher);
  render(<BattleEncounter professor={professor} onLeave={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "A. 3" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "B. 2" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Correct! No healing penalty.");
  expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body);
});

test("winning allows returning to the paused overworld", async () => {
  vi.stubGlobal(
    "fetch",
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
