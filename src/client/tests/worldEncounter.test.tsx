import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type {
  WorldGame,
  WorldGameOptions,
} from "../features/world/Game Mechanics/game";
import WorldPage from "../pages/WorldPage/WorldPage";

// The real game needs a canvas and animation frames; this stand-in lets the test act as the
// game, reporting screens and encounters to the page.
const started: WorldGameOptions[] = [];
const endEncounter = vi.fn();
vi.mock("../features/world/Game Mechanics/game", () => ({
  startWorldGame: (options: WorldGameOptions): WorldGame => {
    started.push(options);
    return { setInput: vi.fn(), endEncounter, stop: vi.fn() };
  },
}));

test("meeting a Legendary professor shows their card, and moving on lets them slip away", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          professors: [
            {
              id: "chao-liu",
              name: "Chao Liu",
              department: "Mechanical Engineering",
              rarity: "Legendary",
            },
          ],
        }),
      ),
    ),
  );
  const user = userEvent.setup();
  render(<WorldPage onBack={vi.fn()} />);
  await vi.waitFor(() => expect(started).toHaveLength(1));
  const game = started[0];
  expect(game.professors).toEqual([
    { id: "chao-liu", name: "Chao Liu", department: "Mechanical Engineering" },
  ]);

  // The game reports a professor two screens away, then the player walking to them.
  act(() =>
    game.onHud({
      screen: { col: 2, row: 2 },
      spawnScreens: [{ col: 3, row: 1 }],
      chasedBy: null,
    }),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "1 Legendary professor is roaming: D2.",
  );
  // A strong professor spots the player and gives chase.
  act(() =>
    game.onHud({
      screen: { col: 2, row: 1 },
      spawnScreens: [{ col: 3, row: 1 }],
      chasedBy: "Chao Liu",
    }),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Chao Liu is chasing you! Outrun them or head home, where you're safe.",
  );
  act(() =>
    game.onHud({
      screen: { col: 3, row: 1 },
      spawnScreens: [{ col: 3, row: 1 }],
      chasedBy: null,
    }),
  );
  expect(screen.getByRole("img", { name: /screen D2\./ })).toBeVisible();
  act(() =>
    game.onEncounter({
      id: "chao-liu",
      name: "Chao Liu",
      department: "Mechanical Engineering",
    }),
  );

  const card = screen.getByRole("dialog", { name: "Chao Liu" });
  expect(card).toHaveTextContent("Legendary · Mechanical Engineering");
  expect(card).toHaveTextContent("three timed coding quizzes");
  expect(screen.getByRole("img", { name: "Chao Liu" })).toHaveAttribute(
    "src",
    expect.stringContaining("chao_liu_front"),
  );
  const keepExploring = screen.getByRole("button", { name: /Keep exploring/ });
  expect(screen.getByRole("button", { name: /Fight professor/ })).toHaveFocus();

  await user.click(keepExploring);
  expect(endEncounter).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
