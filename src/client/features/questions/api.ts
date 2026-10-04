import { ApiError, record, request } from "../../api/request";
import type { PublicQuestion, QuestionAnswer } from "./types";
const invalid = () => new ApiError("Something went wrong. Please try again.");
/**
 * Loads a new question.
 * @param from - "teacher" for one of the school teacher's questions, which pay more tokens.
 */
export async function loadQuestion(from?: "teacher"): Promise<PublicQuestion> {
  const q = record(
    await request(from ? `/api/question?from=${from}` : "/api/question"),
  );
  if (
    typeof q.id !== "string" ||
    (q.source !== "gemini" && q.source !== "fallback") ||
    typeof q.topic !== "string" ||
    typeof q.difficulty !== "string" ||
    typeof q.question !== "string" ||
    !Array.isArray(q.choices) ||
    q.choices.length !== 4 ||
    !q.choices.every(
      (choice): choice is string => typeof choice === "string",
    ) ||
    (q.message !== undefined && typeof q.message !== "string")
  )
    throw invalid();
  return {
    id: q.id,
    source: q.source,
    topic: q.topic,
    difficulty: q.difficulty,
    question: q.question,
    choices: q.choices,
    ...(q.message === undefined ? {} : { message: q.message }),
  };
}
export async function submitAnswer(
  questionId: string,
  selectedIndex: number,
): Promise<QuestionAnswer> {
  const a = record(
    await request("/api/question/answer", { questionId, selectedIndex }),
  );
  if (
    typeof a.correct !== "boolean" ||
    typeof a.answerIndex !== "number" ||
    !Number.isInteger(a.answerIndex) ||
    a.answerIndex < 0 ||
    a.answerIndex > 3 ||
    typeof a.explanation !== "string" ||
    typeof a.tokensAwarded !== "number" ||
    !Number.isSafeInteger(a.tokensAwarded) ||
    a.tokensAwarded < 0 ||
    typeof a.tokens !== "number" ||
    !Number.isSafeInteger(a.tokens) ||
    a.tokens < 0 ||
    typeof a.alreadyAnswered !== "boolean"
  )
    throw invalid();
  return {
    correct: a.correct,
    answerIndex: a.answerIndex,
    explanation: a.explanation,
    tokensAwarded: a.tokensAwarded,
    tokens: a.tokens,
    alreadyAnswered: a.alreadyAnswered,
  };
}
