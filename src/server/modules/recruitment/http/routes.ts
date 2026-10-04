// Gacha and inventory routes: the professor pool, recruiting, and levelling up.

import { publicUser } from "../../accounts/infrastructure/betterAuth.ts";
import { EPIC_PITY, GACHA_CAGES, GACHA_POOL, PULL_COST, inventoryFor, levelUpProfessor, pityFor, pullGacha } from "../application/recruitment.ts";
import type { AppContext } from "../../../http/apiApp.ts";
import { allowMethods, createRouter, httpError, jsonBody } from "../../../http/http.ts";
import { checkOrigin, requireUser } from "../../accounts/http/session.ts";
import { tokenBalance } from "../infrastructure/sqliteInventory.ts";

// How many pulls the gashapon machine's "pull 10" button makes.
const MULTI_PULL = 10;

/**
 * Creates the gacha and inventory routes, mounted under /api.
 * @param context - The database and Better Auth instance the routes use.
 * @returns The router.
 */
export function gachaRoutes({ db, auth }: AppContext) {
    const router = createRouter();

    // Public: the pull cost, every professor with their cage and chance before pity, and the cages.
    router.route("/gacha/pool").all(allowMethods("GET", "HEAD")).get((_request, response) => {
        response.json({ cost: PULL_COST, professors: GACHA_POOL, cages: GACHA_CAGES });
    });

    // The logged-in player's pity, and how many pulls the Epic-or-Legendary guarantee takes.
    router.route("/gacha/pity").all(allowMethods("GET")).get(async (request, response) => {
        const user = await requireUser(auth, request);
        response.json({ cost: PULL_COST, guarantee: EPIC_PITY, pity: pityFor(db, user.id) });
    });

    // Spends PULL_COST tokens to pull a professor in their cage. 409 if the player has too few tokens.
    // With `{ "count": 10 }` it makes ten pulls at once, but only if the player can afford all ten,
    // and replies with `{ pulls, user }` instead.
    router.route("/gacha/pull").all(allowMethods("POST")).post(checkOrigin, jsonBody, async (request, response) => {
        const user = await requireUser(auth, request);
        if (request.body.count === MULTI_PULL) {
            if (tokenBalance(db, user.id) < PULL_COST * MULTI_PULL) throw httpError(409, `You need ${PULL_COST * MULTI_PULL} tokens for ${MULTI_PULL} pulls.`);
            const pulls = [];
            let balance = user.tokens;
            for (let made = 0; made < MULTI_PULL; made++) {
                const pull = pullGacha(db, user.id);
                // Only possible if the tokens were spent elsewhere in the meantime; keep what was pulled.
                if (!pull) break;
                const { tokens, ...prize } = pull;
                balance = tokens;
                pulls.push(prize);
            }
            response.json({ pulls, user: publicUser({ ...user, tokens: balance }) });
            return;
        }
        const pull = pullGacha(db, user.id);
        if (!pull) throw httpError(409, `You need ${PULL_COST} tokens to recruit a professor.`);
        const { tokens, ...prize } = pull;
        response.json({ ...prize, user: publicUser({ ...user, tokens }) });
    });

    // The logged-in player's professors.
    router.route("/inventory").all(allowMethods("GET")).get(async (request, response) => {
        const user = await requireUser(auth, request);
        response.json({ inventory: inventoryFor(db, user.id) });
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
