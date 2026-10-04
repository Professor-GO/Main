/** Frontend-owned transport data; issued questions deliberately omit private answer fields. */
export type PublicQuestion = {
  id: string;
  source: "gemini" | "fallback";
  topic: string;
  difficulty: string;
  question: string;
  choices: string[];
  message?: string;
};

export type QuestionAnswer = {
  correct: boolean;
  answerIndex: number;
  explanation: string;
  tokensAwarded: number;
  tokens: number;
  alreadyAnswered: boolean;
};
