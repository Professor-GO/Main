// Gacha and inventory routes: the professor pool, recruiting, and levelling up.

import { publicUser } from "../../Persistence Layer/auth.ts";
import { GACHA_CAGES, GACHA_POOL, PULL_COST, cagesFor, inventoryFor, levelUpProfessor, pullGacha } from "../../Professor Gacha System/gacha.ts";
import type { AppContext } from "../backend.ts";
import { allowMethods, createRouter, httpError, jsonBody } from "../http.ts";
import { checkOrigin, requireUser } from "../session.ts";

/**
 * Creates the gacha and inventory routes, mounted under /api.
 * @param context - The database and Better Auth instance the routes use.
 * @returns The router.
 */
export function gachaRoutes({ db, auth }: AppContext) {
    const router = createRouter();

    // Public: the pull cost and every professor and cage, with their chances before pity.
    router.route("/gacha/pool").all(allowMethods("GET", "HEAD")).get((_request, response) => {
        response.json({ cost: PULL_COST, professors: GACHA_POOL, cages: GACHA_CAGES });
    });

    // Spends PULL_COST tokens to pull a professor or a cage. 409 if the player has too few tokens.
    router.route("/gacha/pull").all(allowMethods("POST")).post(checkOrigin, jsonBody, async (request, response) => {
        const user = await requireUser(auth, request);
        const pull = pullGacha(db, user.id);
        if (!pull) throw httpError(409, `You need ${PULL_COST} tokens to recruit a professor.`);
        const { tokens, ...prize } = pull;
        response.json({ ...prize, user: publicUser({ ...user, tokens }) });
    });

    // The logged-in player's professors and cages.
    router.route("/inventory").all(allowMethods("GET")).get(async (request, response) => {
        const user = await requireUser(auth, request);
        response.json({ inventory: inventoryFor(db, user.id), cages: cagesFor(db, user.id) });
    });

    // Spends copies of a professor to raise their level. 404 if not owned, 409 if more copies are needed.
    router.route("/inventory/level-up").all(allowMethods("POST")).post(checkOrigin, jsonBody, async (request, response) => {
        const user = await requireUser(auth, request);
        const professorId: unknown = request.body.professorId;
        const result = typeof professorId === "string" ? levelUpProfessor(db, user.id, professorId) : undefined;
        if (!result) throw httpError(404, "You don't have that professor yet.");
        if (!result.levelledUp) {
            const missing = result.item.professor.copiesToLevelUp + 1 - result.item.copies;
            throw httpError(409, `Collect ${missing} more ${missing === 1 ? "copy" : "copies"} of ${result.item.professor.name} to level them up.`);
        }
        response.json({ item: result.item });
    });

    return router;
}
