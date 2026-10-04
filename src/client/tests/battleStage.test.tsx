import { render, screen, waitFor } from "@testing-library/react";
import { gsap } from "gsap";
import { expect, test, vi } from "vitest";
import BattleStage from "../features/battle/BattleStage";
import { NO_INPUT } from "../features/battle/arena";
import type { ArenaInput } from "../features/battle/arena";
import { fighterArt } from "../features/battle/fighters";
import type { BattleView } from "../features/world/battleApi";

const battle: BattleView = {
  id: "stage-test",
  professorId: "frank-wood",
  professorName: "Frank Wood",
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
/**
 * Makes the controls the stage reads every frame.
 * @param held - The controls to hold down.
 * @returns A ref holding them.
 */
function controls(held: Partial<ArenaInput> = {}) {
  return { current: { ...NO_INPUT, ...held } };
}

/**
 * Reads where a fighter's rig is drawn across the arena.
 * @param container - The rendered stage.
 * @param side - Which fighter.
 * @returns The rig's left edge, in arena units.
 */
function rigX(container: HTMLElement, side: "player" | "enemy"): number {
  const transform = container
    .querySelector(`[data-side="${side}"]`)
    ?.getAttribute("transform");
  return Number(/translate\(([-\d.]+)/.exec(transform ?? "")?.[1]);
}

/** Pretends the user has no motion preference. */
function fullMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

test("both rigs face each other, keep readable portraits, and clean up their timelines on unmount", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const prior = gsap.globalTimeline.getChildren().length;
  const { container, unmount } = render(
    <BattleStage
      player={fighterArt("tor-aamodt")}
      enemy={fighterArt("frank-wood")}
      battle={battle}
      onAnimating={vi.fn()}
      input={controls()}
      running={false}
      onLand={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("img", { name: /Tor Aamodt facing Frank Wood/ }),
  ).toBeVisible();
  const enemy = container.querySelector('[data-side="enemy"]');
  expect(enemy?.querySelector('g[transform*="scale(-1 1)"]')).not.toBeNull();
  expect(enemy?.querySelectorAll('g[transform*="scale(-1 1)"]')).toHaveLength(
    2,
  );
  expect(gsap.globalTimeline.getChildren().length).toBeGreaterThan(prior);
  unmount();
  expect(gsap.globalTimeline.getChildren().length).toBe(prior);
});
test("reduced-motion victory keeps the defeated professor down and the winner in a wave pose", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const onAnimating = vi.fn();
  const { container } = render(
    <BattleStage
      player={fighterArt("tor-aamodt")}
      enemy={fighterArt("frank-wood")}
      battle={{ ...battle, version: 1, status: "won", health: 0 }}
      onAnimating={onAnimating}
      input={controls()}
      running={false}
      onLand={vi.fn()}
    />,
  );
  expect(container.querySelector('[data-side="player"]')).toHaveAttribute(
    "data-motion",
    "wave",
  );
  expect(container.querySelector('[data-side="enemy"]')).toHaveAttribute(
    "data-motion",
    "defeated",
  );
  expect(onAnimating).toHaveBeenLastCalledWith(false);
});

test("while the fight runs, holding a control moves the player's fighter", async () => {
  fullMotion();
  const { container } = render(
    <BattleStage
      player={fighterArt("tor-aamodt")}
      enemy={fighterArt("frank-wood")}
      battle={battle}
      onAnimating={vi.fn()}
      input={controls({ left: true })}
      running={true}
      onLand={vi.fn()}
    />,
  );
  const start = rigX(container, "player");
  await waitFor(() => expect(rigX(container, "player")).toBeLessThan(start - 20));
  expect(container.querySelector('[data-side="player"]')).toHaveAttribute(
    "data-motion",
    "walk",
  );
});

test("a paused fight holds both fighters still", async () => {
  fullMotion();
  const { container } = render(
    <BattleStage
      player={fighterArt("tor-aamodt")}
      enemy={fighterArt("frank-wood")}
      battle={{ ...battle, status: "question" }}
      onAnimating={vi.fn()}
      input={controls({ right: true })}
      running={false}
      onLand={vi.fn()}
    />,
  );
  const player = rigX(container, "player");
  const enemy = rigX(container, "enemy");
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(rigX(container, "player")).toBe(player);
  expect(rigX(container, "enemy")).toBe(enemy);
});

test("the professor closes in and punches land, reported for the server to settle", async () => {
  fullMotion();
  const onLand = vi.fn();
  render(
    <BattleStage
      player={fighterArt("tor-aamodt")}
      enemy={fighterArt("frank-wood")}
      battle={battle}
      onAnimating={vi.fn()}
      input={controls({ punch: true })}
      running={true}
      onLand={onLand}
      enemyStats={{ health: 50, attack: 46, defense: 80, speed: 75 }}
    />,
  );
  await waitFor(() => expect(onLand).toHaveBeenCalled(), { timeout: 5000 });
  expect(["player", "enemy"]).toContain(onLand.mock.calls[0][0]);
});

test("both fighters' levels show above their names, with the higher level's stat bonus", () => {
  fullMotion();
  render(
    <BattleStage
      player={fighterArt("tor-aamodt")}
      enemy={fighterArt("frank-wood")}
      battle={{
        ...battle,
        level: 30,
        playerLevel: 10,
        levelBonus: { player: 100, enemy: 200 },
      }}
      onAnimating={vi.fn()}
      input={controls()}
      running={false}
      onLand={vi.fn()}
    />,
  );
  expect(screen.getByText(/YOUR FIGHTER · LV\. 10$/)).toBeVisible();
  expect(screen.getByText(/WILD PROFESSOR · LV\. 30 · 200% STATS/)).toBeVisible();
});
