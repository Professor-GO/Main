// Account procedures: sign up, log in, log out, and "who am I". Better Auth
// (Persistence Layer/auth.ts) does the work: it stores accounts and password hashes,
// and creates and checks sessions. These procedures turn its errors into
// player-friendly messages.

import { APIError } from "better-auth/api";
import { z } from "zod";
import { USERNAME_PATTERN, hiddenEmail, publicUser } from "../../Persistence Layer/auth.ts";
import { accountRateLimit, api, apiError, authHeaders, currentSession, forwardCookies, sameOrigin } from "../base.ts";

const USERNAME_RULE = "Your username needs 3–20 letters, numbers, or underscores.";
const PASSWORD_RULE = "Your password needs 8–128 characters.";

// The body sent to sign up or log in. Spaces around the username are ignored; the
// password is used exactly as typed. Any other fields (such as tokens) are dropped.
const credentials = z.object({
    username: z.string({ error: USERNAME_RULE }).trim().regex(USERNAME_PATTERN, USERNAME_RULE),
    password: z.string({ error: PASSWORD_RULE }).min(8, PASSWORD_RULE).max(128, PASSWORD_RULE),
});

/**
 * Turns an error from Better Auth into one the player can read.
 * @param error - The error Better Auth threw.
 * @returns A player-safe error for known problems (taken usernames, wrong passwords,
 * inactive accounts), or the original error, which is sent as a generic 500.
 */
function friendlyError(error: unknown): unknown {
    const code = error instanceof APIError ? String(error.body?.code ?? "") : "";
    // A UNIQUE error means another player took the username a moment earlier.
    if (["USERNAME_IS_ALREADY_TAKEN", "USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"].includes(code)
        || (error instanceof Error && error.message.includes("UNIQUE constraint failed"))) {
        return apiError(409, "That username is taken. Try another one.");
    }
    if (code === "INVALID_USERNAME_OR_PASSWORD") return apiError(401, "That username and password do not match.");
    if (error instanceof APIError && error.statusCode === 403) return apiError(403, error.message);
    return error;
}

// GET /api/auth/me: the logged-in player's account. Better Auth may refresh or clear the cookie.
export const me = api
    .route({ method: "GET", path: "/auth/me" })
    .handler(async ({ context }) => {
        const { headers, response: session } = await context.auth.api.getSession({ headers: authHeaders(context.request), returnHeaders: true });
        forwardCookies(context, headers);
        if (!session || session.user.isActive === false) throw apiError(401, "Please log in to continue.");
        return { user: publicUser(session.user) };
    });

// POST /api/auth/register: creates an account with STARTING_TOKENS tokens and logs the player in.
export const register = api
    .route({ method: "POST", path: "/auth/register", successStatus: 201 })
    .use(sameOrigin)
    .use(accountRateLimit)
    .input(credentials)
    .handler(async ({ context, input: { username, password } }) => {
        try {
            const { headers, response: result } = await context.auth.api.signUpEmail({
                body: { email: hiddenEmail(username), password, name: username, username, displayUsername: username },
                headers: authHeaders(context.request),
                returnHeaders: true,
            });
            forwardCookies(context, headers);
            return { user: publicUser(result.user) };
        } catch (error) {
            throw friendlyError(error);
        }
    });

// POST /api/auth/login: logs a player in, and ends the browser's previous session if it had one.
export const login = api
    .route({ method: "POST", path: "/auth/login" })
    .use(sameOrigin)
    .use(accountRateLimit)
    .input(credentials)
    .handler(async ({ context, input: { username, password } }) => {
        const previous = await currentSession(context.auth, context.request);
        try {
            const { headers, response: result } = await context.auth.api.signInUsername({
                body: { username, password },
                headers: authHeaders(context.request),
                returnHeaders: true,
            });
            if (previous) await context.auth.api.revokeSession({ body: { token: previous.session.token }, headers: authHeaders(context.request) });
            forwardCookies(context, headers);
            return { user: publicUser(result.user) };
        } catch (error) {
            throw friendlyError(error);
        }
    });

// POST /api/auth/logout: ends the browser's session on the server and deletes its cookie.
export const logout = api
    .route({ method: "POST", path: "/auth/logout" })
    .use(sameOrigin)
    .handler(async ({ context }) => {
        const { headers } = await context.auth.api.signOut({ headers: authHeaders(context.request), returnHeaders: true });
        forwardCookies(context, headers);
        return { message: "You have been logged out." };
    });
