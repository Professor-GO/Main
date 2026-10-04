// Coding questions for the Get tokens page.
//
// Questions come from Google's Gemini API when GEMINI_API_KEY is set in .env
// (GEMINI_MODEL can pick the model to try first). Without a key, or when Gemini
// fails, a built-in fallback question is used, so the page always gets a question.

// How many answer choices every coding question has.
export const QUESTION_CHOICES = 4;

// Models tried after GEMINI_MODEL, in order, until one answers.
const DEFAULT_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];

// How long to wait for each model before trying the next one, in milliseconds.
const GEMINI_TIMEOUT_MS = 7_500;

/** A complete generated question. Its answer and explanation stay private until submission. */
export type CodingQuestion = {
    // Where the question came from: "gemini", or "fallback" for the built-in question.
    source: "gemini" | "fallback";
    // A short programming topic, such as "arrays".
    topic: string;
    // "easy", "medium", or "hard".
    difficulty: string;
    // The question text. It can contain short code snippets on separate lines.
    question: string;
    // The answer options, in the order shown to the player. Always QUESTION_CHOICES long.
    choices: string[];
    // The position in choices of the correct answer, starting at 0.
    answerIndex: number;
    // Why the correct answer is right, shown after the player answers.
    explanation: string;
    // An optional note for the player, such as why a fallback question is shown.
    message?: string;
};

// The parts of Gemini's generateContent reply that we read. Every field is optional
// because Gemini can leave them out, for example when it blocks a reply.
type GeminiResponse = {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
};

/**
 * Builds the built-in coding question, used when Gemini is not set up or does not answer.
 * @returns The fallback question, with the correct answer listed first.
 */
export function fallbackCodingQuestion(): CodingQuestion {
    return {
        source: "fallback",
        topic: "arrays",
        difficulty: "medium",
        question: "The array names holds professor names, some of them repeated. Which JavaScript expression returns the names without duplicates, keeping the order they first appear in?",
        choices: [
            "[...new Set(names)]",
            "names.sort()",
            "names.filter((name, i) => names.indexOf(name) !== i)",
            "names.reverse()",
        ],
        answerIndex: 0,
        explanation: "A Set keeps only the first copy of each value, in the order they were added, so spreading it back into an array removes the duplicates without reordering the names.",
    };
}

/**
 * Shuffles a question's answer choices, so the correct answer is not always in the same place.
 * @param question - The question to shuffle. It is not changed.
 * @param random - Returns a number from 0 (inclusive) to 1 (exclusive). Tests can pass a fixed one.
 * @returns A copy of the question with its choices reordered and answerIndex updated to match.
 */
export function shuffleChoices(question: CodingQuestion, random: () => number = Math.random): CodingQuestion {
    const order = question.choices.map((_, index) => index);
    for (let index = order.length - 1; index > 0; index--) {
        const swap = Math.floor(random() * (index + 1));
        [order[index], order[swap]] = [order[swap], order[index]];
    }
    return { ...question, choices: order.map((index) => question.choices[index]), answerIndex: order.indexOf(question.answerIndex) };
}

/**
 * Reads the question out of Gemini's reply text. Gemini sometimes wraps its JSON in code
 * fences or extra words, so this also tries the first {...} block in the text.
 * @param text - The text Gemini replied with.
 * @returns The question, with surrounding spaces trimmed from every field.
 * @throws Error if the text has no complete question with QUESTION_CHOICES different
 * choices and a valid answerIndex.
 */
export function parseGeminiQuestion(text: string): CodingQuestion {
    const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const candidates = [trimmed, trimmed.match(/\{[\s\S]*\}/)?.[0]].filter((candidate): candidate is string => Boolean(candidate));
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            const choices = Array.isArray(parsed.choices) && parsed.choices.every((choice: unknown) => typeof choice === "string")
                ? (parsed.choices as string[]).map((choice) => choice.trim()) : [];
            if (typeof parsed.question !== "string" || !parsed.question.trim() || typeof parsed.topic !== "string" || typeof parsed.difficulty !== "string"
                || choices.length !== QUESTION_CHOICES || choices.some((choice) => !choice) || new Set(choices).size !== QUESTION_CHOICES
                || !Number.isInteger(parsed.answerIndex) || parsed.answerIndex < 0 || parsed.answerIndex >= QUESTION_CHOICES) {
                throw new Error("Gemini returned an incomplete question payload.");
            }
            return {
                source: "gemini",
                topic: parsed.topic.trim() || "general programming",
                difficulty: parsed.difficulty.trim() || "medium",
                question: parsed.question.trim(),
                choices,
                answerIndex: parsed.answerIndex,
                explanation: typeof parsed.explanation === "string" ? parsed.explanation.trim() : "",
            };
        } catch {
            // Try the next candidate.
        }
    }
    throw new Error("Gemini returned an unexpected question payload.");
}

/**
 * Builds the request body asking Gemini for one multiple-choice coding question as JSON.
 * @returns The generateContent request body.
 */
function buildGeminiPayload(): object {
    return {
        contents: [{
            role: "user",
            parts: [{
                text: `Generate one original multiple-choice coding question for a hackathon game about recruiting university professors. Return valid JSON with exactly these keys: question, topic, difficulty, choices, answerIndex, explanation. question should be one short paragraph; any code in it should be at most a few short lines. topic should be a concise programming topic. difficulty should be easy, medium, or hard. choices should be an array of exactly ${QUESTION_CHOICES} short, different answer options, with exactly one correct. answerIndex should be the 0-based position of the correct option in choices. explanation should be one or two sentences on why the correct option is right. Do not include markdown or code fences.`,
            }],
        }],
        generationConfig: {
            temperature: 0.8,
            responseMimeType: "application/json",
        },
    };
}

/**
 * Asks one Gemini model for a question. Failures are logged without the API key.
 * @param model - The Gemini model name, such as "gemini-2.5-flash".
 * @param apiKey - The Gemini API key. It is sent in a header, never in the URL.
 * @returns The text of Gemini's reply, or null if the model failed, timed out, or sent no text.
 */
async function fetchFromGemini(model: string, apiKey: string): Promise<string | null> {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(buildGeminiPayload()),
            signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        });
        if (!response.ok) {
            console.warn(`Gemini model ${model} replied with HTTP ${response.status}.`);
            return null;
        }
        const data = await response.json() as GeminiResponse;
        const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
        if (!text) console.warn(`Gemini model ${model} sent no text.`);
        return text || null;
    } catch (error) {
        console.warn(`Could not reach Gemini model ${model}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

/**
 * Lists the Gemini models to try, in order, without repeats.
 * @param configuredModel - The GEMINI_MODEL setting, tried first. Ignored when empty.
 * @returns The model names.
 */
export function modelsToTry(configuredModel: string | undefined): string[] {
    return [...new Set([configuredModel, ...DEFAULT_MODELS])].filter((model): model is string => Boolean(model));
}

/**
 * Gets a coding question: from Gemini when GEMINI_API_KEY is set, trying each model
 * until one sends a usable question, and otherwise the built-in fallback question.
 * It never throws, so the page always gets a question.
 * @param random - Used to shuffle the choices. Tests can pass a fixed one.
 * @returns The question with its choices shuffled. If Gemini is set up but fails, the
 * fallback question includes a message saying so.
 */
export async function createCodingQuestion(random: () => number = Math.random): Promise<CodingQuestion> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) return shuffleChoices(fallbackCodingQuestion(), random);
    for (const model of modelsToTry(process.env.GEMINI_MODEL?.trim())) {
        const text = await fetchFromGemini(model, apiKey);
        if (!text) continue;
        try {
            return shuffleChoices(parseGeminiQuestion(text), random);
        } catch (error) {
            console.warn(`Gemini model ${model} sent a question that could not be used: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const message = "Gemini is temporarily unavailable, so this local question is being shown instead.";
    return shuffleChoices({ ...fallbackCodingQuestion(), message }, random);
}
