/** Transitional Node24 suite: migrate node:test/assert to Vitest before client-wide discovery. */
import assert from "node:assert/strict";
import test from "node:test";

import { transitionQuestion } from "../questionState.ts";
import type { QuestionState } from "../questionState.ts";
import type { PublicQuestion, QuestionAnswer } from "../types.ts";

const question: PublicQuestion = {
  id: "attempt-one",
  source: "fallback",
  topic: "arrays",
  difficulty: "easy",
  question: "Which index comes first?",
  choices: ["Zero", "One", "Two", "Three"],
};
const answer: QuestionAnswer = {
  correct: true,
  answerIndex: 0,
  explanation: "Indices begin at zero.",
  tokensAwarded: 0,
  tokens: 51,
  alreadyAnswered: true,
};

test("transport failure allows only the chosen answer to be manually resubmitted", () => {
  const ready: QuestionState = { kind: "ready", question };
  const submitting = transitionQuestion(ready, {
    kind: "choose",
    selectedIndex: 0,
  });
  assert.deepEqual(submitting, {
    kind: "submitting",
    question,
    selectedIndex: 0,
  });
  assert.equal(
    transitionQuestion(submitting, { kind: "choose", selectedIndex: 1 }),
    submitting,
  );
  const failed = transitionQuestion(submitting, {
    kind: "failed",
    message: "Connection lost.",
  });
  assert.deepEqual(failed, {
    kind: "retryableFailure",
    question,
    selectedIndex: 0,
    message: "Connection lost.",
  });
  assert.equal(
    transitionQuestion(failed, { kind: "choose", selectedIndex: 1 }),
    failed,
  );
  assert.deepEqual(
    transitionQuestion(failed, { kind: "choose", selectedIndex: 0 }),
    submitting,
  );
});

test("5xx remains retryable while expiry and other 4xx failures require a new question", () => {
  const submitting: QuestionState = {
    kind: "submitting",
    question,
    selectedIndex: 2,
  };
  assert.equal(
    transitionQuestion(submitting, {
      kind: "failed",
      message: "Unavailable.",
      status: 502,
    }).kind,
    "retryableFailure",
  );
  for (const status of [400, 401, 403, 404, 409, 410, 429]) {
    const terminal = transitionQuestion(submitting, {
      kind: "failed",
      message: "Rejected.",
      status,
    });
    assert.deepEqual(terminal, {
      kind: "terminalFailure",
      question,
      selectedIndex: 2,
      message: "Rejected.",
    });
    assert.equal(
      transitionQuestion(terminal, { kind: "choose", selectedIndex: 2 }),
      terminal,
    );
    assert.deepEqual(transitionQuestion(terminal, { kind: "load" }), {
      kind: "loading",
    });
  }
});

test("successful answer retains the authoritative server balance and replay result without granting tokens locally", () => {
  const submitting: QuestionState = {
    kind: "submitting",
    question,
    selectedIndex: 0,
  };
  const result = transitionQuestion(submitting, { kind: "answered", answer });
  assert.deepEqual(result, {
    kind: "answered",
    question,
    selectedIndex: 0,
    answer,
  });
  assert.equal(
    transitionQuestion(result, { kind: "choose", selectedIndex: 0 }),
    result,
  );
  const wrong = {
    ...answer,
    correct: false,
    answerIndex: 1,
    tokens: 7,
    alreadyAnswered: false,
  };
  assert.deepEqual(
    transitionQuestion(submitting, { kind: "answered", answer: wrong }),
    { kind: "answered", question, selectedIndex: 0, answer: wrong },
  );
});

test("loading failures offer next question rather than an answer retry and pending requests cannot be duplicated", () => {
  const loading: QuestionState = { kind: "loading" };
  assert.equal(transitionQuestion(loading, { kind: "load" }), loading);
  const failed = transitionQuestion(loading, {
    kind: "failed",
    message: "Unavailable.",
    status: 503,
  });
  assert.deepEqual(failed, {
    kind: "terminalFailure",
    message: "Unavailable.",
  });
  assert.deepEqual(transitionQuestion(failed, { kind: "load" }), loading);
  const ready = transitionQuestion(loading, { kind: "loaded", question });
  assert.deepEqual(ready, { kind: "ready", question });
  for (const selectedIndex of [-1, 4, 0.5, NaN]) {
    assert.equal(
      transitionQuestion(ready, { kind: "choose", selectedIndex }),
      ready,
    );
  }
  const submitting = transitionQuestion(ready, {
    kind: "choose",
    selectedIndex: 3,
  });
  assert.equal(transitionQuestion(submitting, { kind: "load" }), submitting);
  assert.equal(
    transitionQuestion(submitting, { kind: "loaded", question }),
    submitting,
  );
  assert.equal(transitionQuestion(ready, { kind: "answered", answer }), ready);
});
