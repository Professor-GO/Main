// Coding question procedures for the Get tokens page.

import { z } from "zod";
import { createCodingQuestion } from "../../Gemini.ts";
import { answerQuestion, saveQuestion } from "../../Persistence Layer/questions.ts";
import { api, apiError, loggedIn, sameOrigin } from "../base.ts";

const ANSWER_RULE = "Choose one of the four answers to your question.";

// GET /api/question: a multiple-choice coding question for the logged-in player, from
// Gemini or the built-in fallback. The answer is saved on the server, not sent.
export const question = api
    .route({ method: "GET", path: "/question" })
    .use(sameOrigin)
    .use(loggedIn)
    .handler(async ({ context }) => saveQuestion(context.db, context.user.id, await createCodingQuestion()));

// POST /api/question/answer: the client sends only its choice; the saved answer decides the reward.
export const answer = api
    .route({ method: "POST", path: "/question/answer" })
    .use(sameOrigin)
    .use(loggedIn)
    .input(z.object({
        questionId: z.string({ error: ANSWER_RULE }).regex(/^[0-9a-f-]{36}$/, ANSWER_RULE),
        selectedIndex: z.number({ error: ANSWER_RULE }).int(ANSWER_RULE).min(0, ANSWER_RULE).max(3, ANSWER_RULE),
    }))
    .handler(({ context, input: { questionId, selectedIndex } }) => {
        const result = answerQuestion(context.db, context.user.id, questionId, selectedIndex);
        if ("error" in result) {
            const errors = {
                invalid: [400, ANSWER_RULE],
                missing: [404, "Question not found. Request a new question."],
                expired: [410, "This question has expired. Request a new question."],
                answered: [409, "You have already answered this question."],
                inactive: [403, "This account is inactive."],
            } as const;
            const [status, message] = errors[result.error];
            throw apiError(status, message);
        }
        return result;
    });
