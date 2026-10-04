import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { expect, test, vi } from "vitest";
import App from "../App";

const player = {
  id: "player-1",
  username: "PlayerOne",
  createdAt: "2026-01-01T00:00:00Z",
  isActive: true,
  tokens: 50,
};
const pool = {
  cost: 10,
  professors: [
    {
      id: "chao-liu",
      name: "Chao Liu",
      department: "Mechanical Engineering",
      rarity: "Legendary",
    },
    {
      id: "tor-aamodt",
      name: "Tor Aamodt",
      department: "Computer Engineering",
      // Only Rare and Epic professors roam. Keeping this pool free of them leaves the map
      // empty, so the test does not depend on when a wild professor happens to appear.
      rarity: "Common",
    },
  ],
  cages: [],
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

/**
 * Opens the app as a logged-in player and goes to the campus map.
 * @param poolReply - What GET /api/gacha/pool replies with.
 * @returns The fetch mock and the user-event helper.
 */
async function openMap(poolReply: Response) {
  // jsdom has no canvas drawing; the map still runs, it just draws nothing.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ user: player }))
    .mockResolvedValueOnce(poolReply);
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await user.click(
    await screen.findByRole("button", { name: /Explore the campus/ }),
  );
  return { fetcher, user };
}

test("the lobby opens the campus map, which starts at home and goes back to the lobby", async () => {
  const { fetcher, user } = await openMap(reply(pool));
  expect(
    screen.getByRole("heading", { name: "The open campus." }),
  ).toHaveFocus();
  expect(
    screen.getByRole("img", { name: /You are on screen C3, at home/ }),
  ).toBeVisible();
  expect(
    await screen.findByText(/No wild professors are roaming today/),
  ).toBeVisible();
  // The professors are loaded once, even under StrictMode.
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][0]).toBe("/api/gacha/pool");
  // Arrow keys move the player instead of scrolling the page; other keys are left alone.
  expect(fireEvent.keyDown(window, { code: "ArrowUp" })).toBe(false);
  expect(fireEvent.keyDown(window, { code: "KeyW" })).toBe(false);
  expect(fireEvent.keyDown(window, { code: "KeyQ" })).toBe(true);
  expect(fireEvent.keyDown(window, { code: "ArrowUp", ctrlKey: true })).toBe(
    true,
  );
  expect(screen.getByRole("group", { name: "Move" })).toBeVisible();
  expect(
    screen.getAllByRole("button", { name: /^(Up|Down|Left|Right)/ }),
  ).toHaveLength(8);

  await user.click(screen.getByRole("button", { name: /Back to lobby/ }));
  expect(
    await screen.findByRole("heading", { name: /Welcome to/ }),
  ).toHaveFocus();
});

test("the map still opens for exploring when the professors can't be loaded", async () => {
  await openMap(reply({ message: "The arena is busy." }, 503));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "The arena is busy. You can still explore.",
    ),
  );
  expect(screen.getByRole("img", { name: /Campus map/ })).toBeVisible();
});
