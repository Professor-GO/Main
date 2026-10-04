import { render, screen } from "@testing-library/react";
import { gsap } from "gsap";
import { expect, test, vi } from "vitest";
import BattleStage from "../features/battle/BattleStage";
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
