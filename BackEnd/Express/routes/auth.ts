// Account routes: sign up, log in, log out, and "who am I". Better Auth (Persistence Layer/auth.ts)
// does the work: it stores accounts and password hashes, and creates and checks sessions.
// These routes keep the website's API the same and turn Better Auth's errors into
// player-friendly messages.

import { APIError } from "better-auth/api";
import { USERNAME_PATTERN, hiddenEmail, publicUser } from "../../Persistence Layer/auth.ts";
import type { AppContext } from "../backend.ts";
import { allowMethods, createRouter, httpError, jsonBody } from "../http.ts";
import { authHeaders, checkOrigin, currentSession, rateLimiter, sendAuthCookies } from "../session.ts";

/**
 * Checks the username and password sent to sign up or log in.
 * @param body - The parsed JSON request body.
 * @returns The trimmed username and the password.
 * @throws HttpError 400 if the username is not 3–20 letters, numbers, or underscores,
 * or the password is not 8–128 characters.
 */
function readCredentials(body: Record<string, unknown>): { username: string; password: string } {
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = body.password;
    if (!USERNAME_PATTERN.test(username)) {
        throw httpError(400, "Your username needs 3–20 letters, numbers, or underscores.");
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
        throw httpError(400, "Your password needs 8–128 characters.");
    }
    return { username, password };
}

/**
 * Turns an error from Better Auth into one the player can read.
 * @param error - The error Better Auth threw.
 * @returns An HttpError for known problems (taken usernames, wrong passwords, inactive
 * accounts), or the original error, which is sent as a generic 500.
 */
function friendlyError(error: unknown): unknown {
    const code = error instanceof APIError ? String(error.body?.code ?? "") : "";
    // A UNIQUE error means another player took the username a moment earlier.
    if (["USERNAME_IS_ALREADY_TAKEN", "USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"].includes(code)
        || (error instanceof Error && error.message.includes("UNIQUE constraint failed"))) {
        return httpError(409, "That username is taken. Try another one.");
    }
    if (code === "INVALID_USERNAME_OR_PASSWORD") return httpError(401, "That username and password do not match.");
    if (error instanceof APIError && error.statusCode === 403) return httpError(403, error.message);
    return error;
}

/**
 * Creates the account routes, mounted under /api.
 * @param context - The Better Auth instance the routes use.
 * @returns The router.
 */
export function authRoutes({ auth }: AppContext) {
    const router = createRouter();
    // Generous limit for the backend itself; the website adds a stricter one per player.
    const accountLimit = rateLimiter(500);

    // Returns the logged-in player's account. Better Auth may refresh or clear the cookie.
    router.route("/auth/me").all(allowMethods("GET")).get(async (request, response) => {
        const { headers, response: session } = await auth.api.getSession({ headers: authHeaders(request), returnHeaders: true });
        sendAuthCookies(response, headers);
        if (!session || session.user.isActive === false) throw httpError(401, "Please log in to continue.");
        response.json({ user: publicUser(session.user) });
    });

    // Creates an account with STARTING_TOKENS tokens and logs the player in.
    router.route("/auth/register").all(allowMethods("POST")).post(checkOrigin, jsonBody, accountLimit, async (request, response) => {
        const { username, password } = readCredentials(request.body);
        try {
            const { headers, response: result } = await auth.api.signUpEmail({
                body: { email: hiddenEmail(username), password, name: username, username, displayUsername: username },
                headers: authHeaders(request),
                returnHeaders: true,
            });
            sendAuthCookies(response, headers);
            response.status(201).json({ user: publicUser(result.user) });
        } catch (error) {
            throw friendlyError(error);
        }
    });

    // Logs a player in, and ends the browser's previous session if it had one.
    router.route("/auth/login").all(allowMethods("POST")).post(checkOrigin, jsonBody, accountLimit, async (request, response) => {
        const { username, password } = readCredentials(request.body);
        const previous = await currentSession(auth, request);
        try {
            const { headers, response: result } = await auth.api.signInUsername({
                body: { username, password },
                headers: authHeaders(request),
                returnHeaders: true,
            });
            if (previous) await auth.api.revokeSession({ body: { token: previous.session.token }, headers: authHeaders(request) });
            sendAuthCookies(response, headers);
            response.json({ user: publicUser(result.user) });
        } catch (error) {
            throw friendlyError(error);
        }
    });

    // Ends the browser's session on the server and deletes its cookie.
    router.route("/auth/logout").all(allowMethods("POST")).post(checkOrigin, jsonBody, async (request, response) => {
        const { headers } = await auth.api.signOut({ headers: authHeaders(request), returnHeaders: true });
        sendAuthCookies(response, headers);
        response.json({ message: "You have been logged out." });
    });

    return router;
}
