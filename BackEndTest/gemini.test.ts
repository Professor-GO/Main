import test from "node:test";
import assert from "node:assert/strict";
import { QUESTION_CHOICES, createCodingQuestion, fallbackCodingQuestion, modelsToTry, parseGeminiQuestion, shuffleChoices } from "../BackEnd/Gemini.ts";

const validQuestion = {
    question: "What does [1, 2, 3].length return?",
    topic: "arrays",
    difficulty: "easy",
    choices: ["3", "2", "undefined", "4"],
    answerIndex: 0,
    explanation: "length counts the items in the array.",
};

/**
 * Runs a test body with GEMINI_API_KEY, GEMINI_MODEL, fetch and console.warn replaced,
 * then puts the originals back.
 * @param settings - The GEMINI_API_KEY and GEMINI_MODEL to use; undefined removes them.
 * @param fakeFetch - Stands in for fetch. Each call is recorded in `calls`.
 * @param body - The test body. It gets the recorded fetch calls and warnings.
 */
async function withGemini(
    settings: { apiKey?: string; model?: string },
    fakeFetch: (url: string) => Response | Promise<Response>,
    body: (calls: { url: string; init?: RequestInit }[], warnings: string[]) => Promise<void>,
): Promise<void> {
    const original = { fetch: globalThis.fetch, warn: console.warn, apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL };
    const calls: { url: string; init?: RequestInit }[] = [];
    const warnings: string[] = [];
    const set = (name: string, value: string | undefined) => { if (value === undefined) delete process.env[name]; else process.env[name] = value; };
    set("GEMINI_API_KEY", settings.apiKey);
    set("GEMINI_MODEL", settings.model);
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return fakeFetch(String(url));
    }) as typeof fetch;
    console.warn = (message: string) => { warnings.push(message); };
    try {
        await body(calls, warnings);
    } finally {
        globalThis.fetch = original.fetch;
        console.warn = original.warn;
        set("GEMINI_API_KEY", original.apiKey);
        set("GEMINI_MODEL", original.model);
    }
}

/**
 * Builds a reply shaped like Gemini's generateContent response.
 * @param text - The text Gemini "replied" with.
 * @returns The fake Response.
 */
function geminiReply(text: string): Response {
    return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
}

test("Gemini's JSON is read into a question, even inside code fences or extra words", () => {
    const expected = { source: "gemini", ...validQuestion };
    assert.deepEqual(parseGeminiQuestion(JSON.stringify(validQuestion)), expected);
    assert.deepEqual(parseGeminiQuestion("```json\n" + JSON.stringify(validQuestion) + "\n```"), expected);
    assert.deepEqual(parseGeminiQuestion("Here you go: " + JSON.stringify(validQuestion)), expected);
    assert.equal(parseGeminiQuestion(JSON.stringify({ ...validQuestion, explanation: undefined })).explanation, "");
});

test("Gemini questions without exactly four different choices and a valid answer are rejected", () => {
    const broken = [
        { ...validQuestion, choices: ["3", "2", "4"] },
        { ...validQuestion, choices: ["3", "2", "4", " 3 "] },
        { ...validQuestion, choices: ["3", "2", "4", ""] },
        { ...validQuestion, choices: ["3", "2", "4", 5] },
        { ...validQuestion, answerIndex: 4 },
        { ...validQuestion, answerIndex: 1.5 },
        { ...validQuestion, answerIndex: "0" },
        { ...validQuestion, question: "  " },
        { ...validQuestion, topic: undefined },
    ];
    for (const question of broken) assert.throws(() => parseGeminiQuestion(JSON.stringify(question)), /question payload/);
    assert.throws(() => parseGeminiQuestion("not JSON at all"), /question payload/);
});

test("shuffling moves the choices but keeps answerIndex on the correct answer", () => {
    const question = fallbackCodingQuestion();
    assert.equal(question.choices.length, QUESTION_CHOICES);
    const correct = question.choices[question.answerIndex];
    const seen = new Set<number>();
    for (const value of [0, 0.3, 0.6, 0.99]) {
        const shuffled = shuffleChoices(question, () => value);
        assert.deepEqual([...shuffled.choices].sort(), [...question.choices].sort());
        assert.equal(shuffled.choices[shuffled.answerIndex], correct);
        seen.add(shuffled.answerIndex);
    }
    assert.ok(seen.size > 1);
    assert.equal(question.choices[question.answerIndex], correct, "the original question is not changed");
});

test("GEMINI_MODEL is tried first, without repeating a default model", () => {
    assert.deepEqual(modelsToTry(undefined), ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"]);
    assert.deepEqual(modelsToTry(""), ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"]);
    assert.deepEqual(modelsToTry("gemini-2.5-flash"), ["gemini-2.5-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite"]);
});

test("without an API key, the fallback question is used and Gemini is never called", async () => {
    await withGemini({}, () => { throw new Error("fetch should not be called"); }, async (calls) => {
        const question = await createCodingQuestion();
        assert.equal(question.source, "fallback");
        assert.equal(question.message, undefined);
        assert.equal(calls.length, 0);
    });
});

test("Gemini's question is used, and the API key goes in a header instead of the URL", async () => {
    await withGemini({ apiKey: "secret-test-key", model: "my-model" }, () => geminiReply(JSON.stringify(validQuestion)), async (calls) => {
        const question = await createCodingQuestion(() => 0);
        assert.equal(question.source, "gemini");
        assert.equal(question.choices[question.answerIndex], "3");
        assert.equal(calls.length, 1);
        assert.match(calls[0].url, /\/models\/my-model:generateContent$/);
        assert.ok(!calls[0].url.includes("secret-test-key"));
        assert.equal((calls[0].init?.headers as Record<string, string>)["x-goog-api-key"], "secret-test-key");
    });
});

test("a failing or unusable model falls through to the next one", async () => {
    const replies = [new Response("", { status: 404 }), geminiReply("not a question"), geminiReply(JSON.stringify(validQuestion))];
    await withGemini({ apiKey: "secret-test-key" }, () => replies.shift() ?? new Response("", { status: 500 }), async (calls, warnings) => {
        const question = await createCodingQuestion();
        assert.equal(question.source, "gemini");
        assert.equal(calls.length, 3);
        assert.equal(warnings.length, 2);
        assert.ok(warnings.every((warning) => !warning.includes("secret-test-key")));
    });
});

test("when every model fails, the fallback question says Gemini is unavailable", async () => {
    await withGemini({ apiKey: "secret-test-key" }, () => { throw new Error("network down"); }, async (calls, warnings) => {
        const question = await createCodingQuestion();
        assert.equal(question.source, "fallback");
        assert.match(question.message ?? "", /temporarily unavailable/);
        assert.equal(calls.length, modelsToTry(undefined).length);
        assert.ok(warnings.some((warning) => warning.includes("network down")));
    });
});
