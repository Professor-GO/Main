/** Exercises untrusted transport values and preserves same-origin request semantics. */
import { expect, test, vi } from "vitest";
import { account } from "../features/accounts/api";
import { loadQuestion, submitAnswer } from "../features/questions/api";
import { request } from "../api/request";

test("rejects malformed player and reward responses instead of trusting transport casts", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 1 } })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ correct: true, answerIndex: 9, tokens: -1 }),
        ),
      ),
  );
  await expect(account("me")).rejects.toThrow("Something went wrong");
  await expect(submitAnswer("attempt", 0)).rejects.toThrow(
    "Something went wrong",
  );
});

test("projects public question fields without leaked answers", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "q",
            source: "fallback",
            topic: "TS",
            difficulty: "easy",
            question: "Q",
            choices: ["a", "b", "c", "d"],
            answerIndex: 1,
            explanation: "secret",
          }),
        ),
      ),
  );
  expect(await loadQuestion()).toEqual({
    id: "q",
    source: "fallback",
    topic: "TS",
    difficulty: "easy",
    question: "Q",
    choices: ["a", "b", "c", "d"],
  });
});

test("request preserves status and JSON body and never retries automatically", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ message: "Try later" }), { status: 503 }),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    request("/api/auth/login", { username: "P", password: "secret" }),
  ).rejects.toMatchObject({ status: 503, message: "Try later" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    credentials: "same-origin",
    cache: "no-store",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "P", password: "secret" }),
  });
});
