import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { expect, test, vi } from "vitest";
import App from "../App";

const player = {
  id: "player-1",
  username: "PlayerOne",
  createdAt: "2026-01-01T00:00:00Z",
  isActive: true,
  tokens: 25,
};
const pool = {
  cost: 10,
  professors: [
    { id: "chao-liu", rarity: "Legendary", pullChance: 0.0008 },
    { id: "tor-aamodt", rarity: "Epic", pullChance: 0.05 },
    { id: "craig-scratchley", rarity: "Rare", pullChance: 0.4746 },
    { id: "guy-lumieux", rarity: "Common", pullChance: 0.4746 },
  ],
  cages: [],
};
const pullReply = (tokens: number, epic: number) => ({
  item: {
    level: 1,
    copies: 1,
    obtainedAt: "2026-10-04T00:00:00Z",
    professor: {
      id: "tor-aamodt",
      name: "Tor Aamodt",
      department: "Computer Engineering",
      rarity: "Epic",
      cage: { id: "iron-cage", name: "Iron Cage" },
      stats: { health: 57, attack: 52, defense: 75, speed: 70 },
      copiesToLevelUp: 3,
    },
  },
  isNew: true,
  pity: { legendary: 9, epic },
  user: { ...player, tokens },
});
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

/**
 * Opens the app as a logged-in player and goes to the recruit page.
 * @param replies - What the server answers after the session and the machine have loaded.
 * @param still - Whether the player prefers reduced motion, which skips the animation.
 * @returns The fetch mock and the user-event helper.
 */
async function openRecruit(replies: Response[], still = true) {
  // jsdom has no canvas drawing; the globe still runs, it just draws nothing.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal("matchMedia", () => ({ matches: still }));
  const fetcher = vi.fn(async (path: string) => {
    if (path === "/api/auth/me") return reply({ user: player });
    if (path === "/api/gacha/pity")
      return reply({ cost: 10, guarantee: 10, pity: { legendary: 8, epic: 8 } });
    if (path === "/api/gacha/pool") return reply(pool);
    return replies.shift() ?? reply({ message: "Unexpected request." }, 500);
  });
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await user.click(
    await screen.findByRole("button", { name: /Recruit a professor/ }),
  );
  return { fetcher, user };
}

test("a pull reveals the professor in their cage and updates the tokens and pity bar", async () => {
  const { fetcher, user } = await openRecruit([reply(pullReply(15, 0))]);
  expect(
    screen.getByRole("heading", { name: "Recruit a professor." }),
  ).toHaveFocus();
  const bar = await screen.findByRole("progressbar", {
    name: "Epic or Legendary guarantee",
  });
  expect(bar).toHaveAttribute("aria-valuenow", "8");
  expect(
    screen.getByText(/guaranteed within 2 pulls/),
  ).toBeVisible();
  expect(screen.getByText("0.08%")).toBeVisible();
  expect(screen.getByText("94.92%")).toBeVisible();
  // The machine is loaded once, even under StrictMode.
  const loads = (path: string) =>
    fetcher.mock.calls.filter(([called]) => called === path).length;
  expect(loads("/api/gacha/pity")).toBe(1);

  await user.click(screen.getByRole("button", { name: "Pull for 10 tokens" }));
  const card = await screen.findByRole("article", { name: "Tor Aamodt" });
  expect(within(card).getByText("★ NEW RECRUIT")).toBeVisible();
  expect(within(card).getByText(/Computer Engineering · Iron Cage/)).toBeVisible();
  expect(within(card).getByText("3 more to level up", { exact: false })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(
    "You recruited Tor Aamodt, an Epic professor!",
  );
  // An Epic restarts the count toward the guarantee.
  expect(bar).toHaveAttribute("aria-valuenow", "0");
  expect(screen.getByText(/guaranteed within 10 pulls/)).toBeVisible();
  expect(document.getElementById("recruit-tokens")).toHaveTextContent("15");
  expect(fetcher).toHaveBeenCalledWith(
    "/api/gacha/pull",
    expect.objectContaining({ method: "POST" }),
  );

  // The lobby shows the new balance too.
  await user.click(screen.getByRole("button", { name: /Back to lobby/ }));
  expect(document.getElementById("account-tokens")).toHaveTextContent("15");
});

test("skipping the animation shows the professor straight away", async () => {
  const { user } = await openRecruit([reply(pullReply(15, 0))], false);
  await user.click(
    await screen.findByRole("button", { name: "Pull for 10 tokens" }),
  );
  expect(screen.getByRole("button", { name: "Recruiting…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: /Back to lobby/ })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /Skip/ }));
  expect(
    await screen.findByRole("article", { name: "Tor Aamodt" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Pull again for 10 tokens" }),
  ).toBeEnabled();
});

test("a failed pull shows the server's message, and a short balance points to the pop quiz", async () => {
  const { user } = await openRecruit([
    reply(pullReply(5, 9)),
    reply({ message: "You need 10 tokens to recruit a professor." }, 409),
  ]);
  await user.click(
    await screen.findByRole("button", { name: "Pull for 10 tokens" }),
  );
  await screen.findByRole("article", { name: "Tor Aamodt" });
  expect(
    screen.getByText("Your next pull is a guaranteed Epic or Legendary professor!"),
  ).toBeVisible();
  // 5 tokens left: the pull button is disabled and the quiz is one click away.
  expect(
    screen.getByRole("button", { name: "Pull again for 10 tokens" }),
  ).toBeDisabled();
  expect(screen.getByText(/You need 5 more tokens/)).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: /Answer a pop quiz to earn some/ }),
  );
  expect(
    await screen.findByRole("heading", { name: "Pop quiz." }),
  ).toBeVisible();
});

test("a machine that fails to load can be retried", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  let failures = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/auth/me") return reply({ user: player });
      if (path === "/api/gacha/pity" && failures-- > 0)
        return reply({ message: "The arena is busy." }, 503);
      if (path === "/api/gacha/pity")
        return reply({ cost: 10, guarantee: 10, pity: { legendary: 0, epic: 0 } });
      return reply(pool);
    }),
  );
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole("button", { name: /Recruit a professor/ }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The arena is busy.",
  );
  expect(
    screen.getByRole("button", { name: "Pull for … tokens" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /Try again/ }));
  expect(
    await screen.findByRole("button", { name: "Pull for 10 tokens" }),
  ).toBeEnabled();
});
