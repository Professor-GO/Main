// Coding question route for the Get tokens page.

import { createCodingQuestion } from "../infrastructure/gemini.ts";
import { answerQuestion, saveQuestion } from "../infrastructure/sqliteQuestions.ts";
import type { AppContext } from "../../../http/apiApp.ts";
import { allowMethods, createRouter, httpError, jsonBody } from "../../../http/http.ts";
import { checkOrigin, requireUser } from "../../accounts/http/session.ts";

/**
 * Creates the coding question route, mounted under /api.
 * @param context - The database and Better Auth instance used for player questions.
 * @returns The router.
 */
export function questionRoutes({ auth, db }: AppContext) {
    const router = createRouter();

    // A multiple-choice coding question for the logged-in player, from Gemini or the built-in fallback.
    router.route("/question").all(allowMethods("GET")).get(checkOrigin, async (request, response) => {
        const user = await requireUser(auth, request);
        response.json(saveQuestion(db, user.id, await createCodingQuestion()));
    });

    // The client sends only its choice. The saved answer determines the reward.
    router.route("/question/answer").all(allowMethods("POST")).post(checkOrigin, jsonBody, async (request, response) => {
        const user = await requireUser(auth, request);
        const { questionId, selectedIndex } = request.body as Record<string, unknown>;
        if (typeof questionId !== "string" || !/^[0-9a-f-]{36}$/.test(questionId)
            || typeof selectedIndex !== "number" || !Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 3) {
            throw httpError(400, "Choose one of the four answers to your question.");
        }
        const result = answerQuestion(db, user.id, questionId, selectedIndex);
        if ("error" in result) {
            const errors = {
                invalid: [400, "Choose one of the four answers to your question."],
                missing: [404, "Question not found. Request a new question."],
                expired: [410, "This question has expired. Request a new question."],
                answered: [409, "You have already answered this question."],
                inactive: [403, "This account is inactive."],
            } as const;
            const [status, message] = errors[result.error];
            throw httpError(status, message);
        }
        response.json(result);
    });

    return router;
}
