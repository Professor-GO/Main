/** Models question recovery without performing requests or deciding server-owned rewards. */
import type { PublicQuestion, QuestionAnswer } from "./types.ts";

export type QuestionState =
  | { kind: "loading" }
  | { kind: "ready"; question: PublicQuestion }
  | { kind: "submitting"; question: PublicQuestion; selectedIndex: number }
  | {
      kind: "answered";
      question: PublicQuestion;
      selectedIndex: number;
      answer: QuestionAnswer;
    }
  | {
      kind: "retryableFailure";
      question: PublicQuestion;
      selectedIndex: number;
      message: string;
    }
  | {
      kind: "terminalFailure";
      message: string;
      question?: PublicQuestion;
      selectedIndex?: number;
    };

export type QuestionEvent =
  | { kind: "load" }
  | { kind: "loaded"; question: PublicQuestion }
  | { kind: "choose"; selectedIndex: number }
  | { kind: "answered"; answer: QuestionAnswer }
  | { kind: "failed"; message: string; status?: number };

/**
 * Applies one user intent or completed request while preserving same-choice recovery.
 * @param state Current page-local state.
 * @param event Explicit intent or request outcome; this function never starts a request.
 * @returns Next state, or the same state when the event is unavailable or stale.
 */
export function transitionQuestion(
  state: QuestionState,
  event: QuestionEvent,
): QuestionState {
  switch (event.kind) {
    case "load":
      return state.kind === "loading" || state.kind === "submitting"
        ? state
        : { kind: "loading" };
    case "loaded":
      return state.kind === "loading"
        ? { kind: "ready", question: event.question }
        : state;
    case "choose": {
      if (state.kind !== "ready" && state.kind !== "retryableFailure")
        return state;
      if (
        !Number.isInteger(event.selectedIndex) ||
        event.selectedIndex < 0 ||
        event.selectedIndex >= state.question.choices.length
      )
        return state;
      if (
        state.kind === "retryableFailure" &&
        event.selectedIndex !== state.selectedIndex
      )
        return state;
      return {
        kind: "submitting",
        question: state.question,
        selectedIndex: event.selectedIndex,
      };
    }
    case "answered":
      return state.kind === "submitting"
        ? {
            kind: "answered",
            question: state.question,
            selectedIndex: state.selectedIndex,
            answer: event.answer,
          }
        : state;
    case "failed":
      if (state.kind === "loading")
        return { kind: "terminalFailure", message: event.message };
      if (state.kind !== "submitting") return state;
      return {
        kind:
          !event.status || event.status >= 500
            ? "retryableFailure"
            : "terminalFailure",
        question: state.question,
        selectedIndex: state.selectedIndex,
        message: event.message,
      };
  }
}
