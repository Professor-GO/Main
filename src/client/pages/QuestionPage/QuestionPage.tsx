import { useEffect, useReducer, useRef } from "react";
import { ApiError, errorMessage } from "../../api/request";
import { loadQuestion, submitAnswer } from "../../features/questions/api";
import type { PublicQuestion } from "../../features/questions/types";
import { transitionQuestion } from "../../features/questions/questionState";
import "./QuestionPage.css";

type QuestionPageProps = {
  onBack: () => void;
  onTokens: (tokens: number) => void;
};
export default function QuestionPage({ onBack, onTokens }: QuestionPageProps) {
  const [state, dispatch] = useReducer(transitionQuestion, { kind: "loading" });
  const title = useRef<HTMLHeadingElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const initialQuestion = useRef<Promise<PublicQuestion> | null>(null);
  useEffect(() => {
    mounted.current = true;
    document.title = "Pop quiz · Professor-Go";
    title.current?.focus();
    let active = true;
    initialQuestion.current ??= loadQuestion();
    initialQuestion.current
      .then((question) => {
        if (active) dispatch({ kind: "loaded", question });
      })
      .catch((error: unknown) => {
        if (active) dispatch({ kind: "failed", message: errorMessage(error) });
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (state.kind === "answered") next.current?.focus();
  }, [state.kind]);
  async function load() {
    if (busy.current || state.kind === "loading" || state.kind === "submitting")
      return;
    busy.current = true;
    dispatch({ kind: "load" });
    try {
      const question = await loadQuestion();
      if (mounted.current) dispatch({ kind: "loaded", question });
    } catch (error) {
      if (mounted.current)
        dispatch({ kind: "failed", message: errorMessage(error) });
    } finally {
      busy.current = false;
    }
  }
  async function choose(index: number) {
    if (
      busy.current ||
      (state.kind !== "ready" && state.kind !== "retryableFailure") ||
      (state.kind === "retryableFailure" && index !== state.selectedIndex)
    )
      return;
    busy.current = true;
    dispatch({ kind: "choose", selectedIndex: index });
    try {
      const answer = await submitAnswer(state.question.id, index);
      if (mounted.current) {
        dispatch({ kind: "answered", answer });
        onTokens(answer.tokens);
      }
    } catch (error) {
      if (mounted.current)
        dispatch({
          kind: "failed",
          message: errorMessage(error),
          status: error instanceof ApiError ? error.status : undefined,
        });
    } finally {
      busy.current = false;
    }
  }
  const question = "question" in state ? state.question : undefined;
  const answer = state.kind === "answered" ? state.answer : undefined;
  const status =
    state.kind === "loading"
      ? "Summoning a coding question…"
      : state.kind === "submitting"
        ? "Checking your answer…"
        : state.kind === "answered"
          ? `Your balance: ${new Intl.NumberFormat().format(state.answer.tokens)} tokens.`
          : state.kind === "retryableFailure"
            ? `${state.message} Select your answer again to retry.`
            : state.kind === "terminalFailure"
              ? state.message
              : (state.question.message ?? "");
  return (
    <section id="question-view" aria-labelledby="question-title">
      <button
        className="back-button"
        id="question-back"
        type="button"
        disabled={state.kind === "submitting"}
        onClick={onBack}
      >
        <span aria-hidden="true">←</span> Back to lobby
      </button>
      <p className="eyebrow">
        <span className="tiny-cross" aria-hidden="true">
          ✦
        </span>{" "}
        GET TOKENS · POP QUIZ
      </p>
      <h1 ref={title} id="question-title" tabIndex={-1}>
        Pop quiz<span className="accent-dot">.</span>
      </h1>
      <p className="intro">
        Pick the answer you think is right.
        <br />
        Each correct answer earns 1 token.
      </p>
      {question && (
        <div className="question-card" id="question-card">
          <p className="question-meta" id="question-meta">
            {question.topic} · {question.difficulty} ·{" "}
            {question.source === "gemini" ? "Gemini" : "Local fallback"}
          </p>
          <p className="question-body" id="question-body">
            {question.question}
          </p>
          <div
            className="question-choices"
            id="question-choices"
            role="group"
            aria-labelledby="question-body"
          >
            {question.choices.map((choice, index) => (
              <button
                key={index}
                type="button"
                className={`choice-button${answer?.answerIndex === index ? " is-correct" : state.kind === "answered" && state.selectedIndex === index ? " is-wrong" : ""}`}
                disabled={
                  state.kind !== "ready" &&
                  !(
                    state.kind === "retryableFailure" &&
                    state.selectedIndex === index
                  )
                }
                onClick={() => choose(index)}
              >
                <span className="choice-letter">
                  {String.fromCharCode(65 + index)}
                </span>
                <span className="choice-text">{choice}</span>
              </button>
            ))}
          </div>
          {answer && (
            <div
              className="question-feedback"
              id="question-feedback"
              role="status"
            >
              <strong id="question-result">
                {answer.correct
                  ? answer.tokensAwarded === 1
                    ? "Correct! +1 token."
                    : "Correct! Your token was already awarded."
                  : `Not quite. The answer is ${String.fromCharCode(65 + answer.answerIndex)}. No tokens earned.`}
              </strong>
              <p id="question-explanation" hidden={!answer.explanation}>
                {answer.explanation}
              </p>
            </div>
          )}
        </div>
      )}
      <p className="session-status" id="question-status" role="status">
        {status}
      </p>
      <button
        ref={next}
        className="secondary-button"
        id="question-next"
        type="button"
        hidden={state.kind !== "answered" && state.kind !== "terminalFailure"}
        onClick={load}
      >
        Next question <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}
