// Gacha and inventory procedures: the professor pool, recruiting, and levelling up.

import { z } from "zod";
import { publicUser } from "../../Persistence Layer/auth.ts";
import { EPIC_PITY, GACHA_POOL, PULL_COST, inventoryFor, levelUpProfessor, pityFor, pullGacha } from "../../Professor Gacha System/gacha.ts";
import { api, apiError, loggedIn, sameOrigin } from "../base.ts";

// GET /api/gacha/pool (public): the pull cost and every professor, with their cage and chance before pity.
export const pool = api
    .route({ method: "GET", path: "/gacha/pool" })
    .meta({ allowHead: true })
    .handler(() => ({ cost: PULL_COST, professors: GACHA_POOL }));

// POST /api/gacha/pull: spends PULL_COST tokens to pull a professor. 409 if the player has too few tokens.
// The reply has the professor's inventory `item` (`item.professor.cage` is the cage they arrive in), `isNew`,
// the player's `pity`, and their updated `user`.
export const pull = api
    .route({ method: "POST", path: "/gacha/pull" })
    .use(sameOrigin)
    .use(loggedIn)
    .handler(({ context }) => {
        const result = pullGacha(context.db, context.user.id);
        if (!result) throw apiError(409, `You need ${PULL_COST} tokens to recruit a professor.`);
        const { tokens, ...prize } = result;
        return { ...prize, user: publicUser({ ...context.user, tokens }) };
    });

// GET /api/gacha/pity: the logged-in player's pity, and `epicPity`: how many pulls in a row
// without an Epic or Legendary professor guarantee one (pity.epic counts toward it).
export const pity = api
    .route({ method: "GET", path: "/gacha/pity" })
    .use(loggedIn)
    .handler(({ context }) => ({ pity: pityFor(context.db, context.user.id), epicPity: EPIC_PITY }));

// GET /api/inventory: the logged-in player's professors.
export const inventory = api
    .route({ method: "GET", path: "/inventory" })
    .use(loggedIn)
    .handler(({ context }) => ({ inventory: inventoryFor(context.db, context.user.id) }));

// POST /api/inventory/level-up: spends copies of a professor to raise their level.
// 404 if the player does not own that professor (including ids that are not text), 409 if more copies are needed.
export const levelUp = api
    .route({ method: "POST", path: "/inventory/level-up" })
    .use(sameOrigin)
    .use(loggedIn)
    .input(z.object({ professorId: z.unknown().optional() }))
    .handler(({ context, input: { professorId } }) => {
        const result = typeof professorId === "string" ? levelUpProfessor(context.db, context.user.id, professorId) : undefined;
        if (!result) throw apiError(404, "You don't have that professor yet.");
        if (!result.levelledUp) {
            const missing = result.item.professor.copiesToLevelUp + 1 - result.item.copies;
            throw apiError(409, `Collect ${missing} more ${missing === 1 ? "copy" : "copies"} of ${result.item.professor.name} to level them up.`);
        }
        return { item: result.item };
    });
