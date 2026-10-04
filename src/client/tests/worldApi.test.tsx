import { expect, test, vi } from "vitest";
import { loadInventory, pullGacha } from "../features/world/api";

const professor = { id: "tor-aamodt", name: "Tor Aamodt", rarity: "Epic" };
const prize = {
  item: { professor, level: 1, copies: 2 },
  isNew: false,
  pity: { epic: 0 },
};

test("the school machine accepts the existing professor pull response without a kind field", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ ...prize, user: { tokens: 40 } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await pullGacha(1)).toEqual({
    tokens: 40,
    pulls: [{ kind: "professor", professor, isNew: false, copies: 2 }],
  });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({});
});

test("the school machine reads ten professor results and sends the bulk-pull count", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({
        pulls: Array.from({ length: 10 }, () => prize),
        user: { tokens: 50 },
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const result = await pullGacha(10);
  expect(result.tokens).toBe(50);
  expect(result.pulls).toHaveLength(10);
  expect(result.pulls.every((pull) => pull.kind === "professor")).toBe(true);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ count: 10 });
});

test("world inventory remains compatible with the current professor-only API", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ inventory: [prize.item] })),
  );
  expect(await loadInventory()).toEqual({
    professors: [{ ...professor, level: 1 }],
    cages: [],
  });
});
