import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import InventoryPage from "../pages/InventoryPage/InventoryPage";
import { loadInventory } from "../features/recruitment/inventory";

const item = {
  level: 2,
  copies: 3,
  professor: {
    id: "tor-aamodt",
    name: "Tor Aamodt",
    department: "Computer Engineering",
    rarity: "Epic",
    stats: { health: 57, attack: 52, defense: 75, speed: 70 },
  },
};

test("inventory shows owned professors with portraits, levels, copies and stats", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ inventory: [item] })),
  );
  const back = vi.fn();
  render(<InventoryPage onBack={back} onRecruit={vi.fn()} />);
  expect(
    await screen.findByRole("heading", { name: "Tor Aamodt" }),
  ).toBeVisible();
  expect(screen.getByText("Epic · Lv. 2")).toBeVisible();
  expect(screen.getByText("3 copies owned")).toBeVisible();
  expect(screen.getByText("57")).toBeVisible();
  expect(document.querySelector(".inventory-card img")).toHaveAttribute(
    "src",
    expect.stringContaining("tor_aamodt_front"),
  );
  fireEvent.click(screen.getByRole("button", { name: /Back to lobby/ }));
  expect(back).toHaveBeenCalledOnce();
});

test("an empty inventory offers recruitment", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ inventory: [] })),
  );
  const recruit = vi.fn();
  render(<InventoryPage onBack={vi.fn()} onRecruit={recruit} />);
  await screen.findByRole("heading", { name: "No professors yet" });
  fireEvent.click(screen.getByRole("button", { name: /Recruit a professor/ }));
  expect(recruit).toHaveBeenCalledOnce();
});

test("a collection failure offers retry and recovers", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Response.json({ inventory: [item] })),
  );
  render(<InventoryPage onBack={vi.fn()} onRecruit={vi.fn()} />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("heading", { name: "Tor Aamodt" }),
  ).toBeVisible();
});

test("invalid inventory values are rejected before rendering", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ inventory: [{ ...item, copies: -1 }] }),
      ),
  );
  await expect(loadInventory()).rejects.toThrow("Invalid professor collection");
});
