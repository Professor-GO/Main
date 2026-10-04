import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { CodingQuestion } from "./gemini.ts";

export const QUESTION_REWARD = 1;
// Tokens for a correct answer to a question from the teacher in the school.
export const TEACHER_QUESTION_REWARD = 10;
export const QUESTION_LIFETIME_MS = 30 * 60 * 1000;
const schema = readFileSync(new URL("./questions.sql", import.meta.url), "utf8");

/** The question sent to the browser. The correct answer stays on the server. */
export type PublicQuestion = Omit<CodingQuestion, "answerIndex" | "explanation"> & { id: string };

export type QuestionAnswer = {
    correct: boolean;
    answerIndex: number;
    explanation: string;
    tokensAwarded: number;
    tokens: number;
    alreadyAnswered: boolean;
};

type StoredQuestion = {
    question_json: string;
    expires_at: number;
    selected_index: number | null;
};

/**
 * Creates the question storage alongside the account and inventory tables.
 * @param db - The game's open database.
 */
export function initializeQuestions(db: DatabaseSync): void {
    db.exec(schema);
}

/**
 * Saves a generated question for one player and hides the answer from the browser.
 * @param db - The game's open database.
 * @param userId - The player who may answer this question.
 * @param question - The complete generated question, with shuffled choices.
 * @param reward - The tokens a correct first answer earns. It is saved with the question,
 * so the browser cannot change it when answering.
 * @returns The question id and public question fields.
 */
export function saveQuestion(db: DatabaseSync, userId: string, question: CodingQuestion, reward: number = QUESTION_REWARD): PublicQuestion {
    const id = randomUUID();
    db.prepare("INSERT INTO question_attempts (id, user_id, question_json, expires_at) VALUES (?, ?, ?, ?)")
        .run(id, userId, JSON.stringify({ ...question, reward }), Date.now() + QUESTION_LIFETIME_MS);
    const { answerIndex, explanation, ...visible } = question;
    return { ...visible, id };
}

/**
 * Checks one answer and awards the question's reward for a correct first submission. Both writes
 * commit together. Repeating the same submission returns its result without another reward.
 * @param db - The game's open database.
 * @param userId - The authenticated player submitting the answer.
 * @param questionId - The id issued by saveQuestion().
 * @param selectedIndex - The selected option, from 0 to 3.
 * @returns The answer and current balance, or an error for an invalid/unavailable attempt.
 * @throws If a database operation fails; neither the answer nor reward is saved.
 */
export function answerQuestion(db: DatabaseSync, userId: string, questionId: string, selectedIndex: number):
    QuestionAnswer | { error: "invalid" | "missing" | "expired" | "answered" | "inactive" } {
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 3) return { error: "invalid" };
    db.exec("BEGIN IMMEDIATE");
    try {
        const row = db.prepare("SELECT question_json, expires_at, selected_index FROM question_attempts WHERE id = ? AND user_id = ?")
            .get(questionId, userId) as StoredQuestion | undefined;
        const problem = !row ? "missing"
            : row.selected_index !== null && row.selected_index !== selectedIndex ? "answered"
            : row.selected_index === null && row.expires_at <= Date.now() ? "expired" : undefined;
        if (problem || !row) {
            db.exec("ROLLBACK");
            return { error: problem ?? "missing" };
        }
        // Questions saved before rewards could differ have none, and earn the usual reward.
        const question = JSON.parse(row.question_json) as CodingQuestion & { reward?: number };
        const correct = selectedIndex === question.answerIndex;
        const alreadyAnswered = row.selected_index !== null;
        const tokensAwarded = correct && !alreadyAnswered ? question.reward ?? QUESTION_REWARD : 0;
        const user = db.prepare('UPDATE "user" SET tokens = tokens + ? WHERE id = ? AND isActive = 1 RETURNING tokens')
            .get(tokensAwarded, userId) as { tokens: number } | undefined;
        if (!user) {
            db.exec("ROLLBACK");
            return { error: "inactive" };
        }
        if (!alreadyAnswered) {
            db.prepare("UPDATE question_attempts SET selected_index = ?, answered_at = ? WHERE id = ?")
                .run(selectedIndex, Date.now(), questionId);
        }
        db.exec("COMMIT");
        return { correct, answerIndex: question.answerIndex, explanation: question.explanation, tokensAwarded, tokens: user.tokens, alreadyAnswered };
    } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
    }
}
