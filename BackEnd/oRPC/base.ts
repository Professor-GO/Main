// The building blocks every oRPC procedure uses: the request context, player-safe
// errors, and middleware for same-website checks, logging in, and rate limiting.
//
// Each API endpoint is an oRPC procedure (see procedures/). `api` below is the starting
// point for every procedure: api.route({ method, path }).input(schema).handler(...).

import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { ORPCError, os } from "@orpc/server";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "../Persistence Layer/auth.ts";

/** What every procedure can read from its context. Built per request in handler.ts. */
export type ApiContext = {
    // The incoming request, for its headers (session cookie, Origin) and IP address.
    request: IncomingMessage;
    // The open game database.
    db: DatabaseSync;
    // Better Auth, which handles accounts, passwords, and sessions.
    auth: Auth;
    // The APP_ENV setting: "development", "test", or "production".
    environment: string;
    // Counts a sign-up or log-in attempt from an IP address; false once it is over the limit.
    allowAccountAttempt: (ip: string | undefined) => boolean;
    // Headers to add to the response, such as Set-Cookie. Provided by ResponseHeadersPlugin.
    resHeaders?: Headers;
};

/** Extra settings a procedure can declare with .meta(). */
export type ApiMeta = {
    // Also answer HEAD requests (GET without a body). Only for GET procedures.
    allowHead?: boolean;
};

/** The base every procedure is built from. */
export const api = os.$context<ApiContext>().$meta<ApiMeta>({});

// oRPC error codes for the HTTP statuses the API uses.
const ERROR_CODES: Record<number, string> = {
    400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND",
    409: "CONFLICT", 410: "GONE", 429: "TOO_MANY_REQUESTS",
};

/**
 * Creates an error the player can read. Throw it from a procedure or middleware.
 * The response is `{ message }` with the given status.
 * @param status - The HTTP status, such as 400 or 409.
 * @param message - The message shown to the player.
 * @returns The error.
 */
export function apiError(status: number, message: string): ORPCError<string, undefined> {
    return new ORPCError(ERROR_CODES[status] ?? "BAD_REQUEST", { status, message });
}

/**
 * Converts a request's headers into the Headers object Better Auth's functions take,
 * so Better Auth can read the session cookie.
 * @param request - The incoming request.
 * @returns The request's headers.
 */
export function authHeaders(request: IncomingMessage): Headers {
    return fromNodeHeaders(request.headers);
}

/**
 * Copies the cookies Better Auth set (such as a new or deleted session cookie) onto the response.
 * @param context - The procedure's context.
 * @param headers - The headers Better Auth returned.
 */
export function forwardCookies(context: ApiContext, headers: Headers): void {
    for (const cookie of headers.getSetCookie()) context.resHeaders?.append("Set-Cookie", cookie);
}

/**
 * Gets the logged-in player for a request, if there is one.
 * @param auth - The Better Auth instance.
 * @param request - The incoming request, carrying the session cookie.
 * @returns The player's session and account, or null if there is no valid session or
 * the account is inactive.
 */
export async function currentSession(auth: Auth, request: IncomingMessage) {
    const session = await auth.api.getSession({ headers: authHeaders(request) });
    return session && session.user.isActive !== false ? session : null;
}

/**
 * Middleware that blocks requests sent from other websites, so another site cannot act
 * on a player's account using their cookie. Throws 403 for cross-site requests.
 */
export const sameOrigin = api.middleware(({ context, next }) => {
    const { headers } = context.request;
    const blocked = apiError(403, "Use this website to manage your account.");
    if (headers["sec-fetch-site"] === "cross-site") throw blocked;
    if (headers.origin) {
        let host: string | undefined;
        try { host = new URL(headers.origin).host; } catch { /* Rejected below. */ }
        if (host !== headers.host) throw blocked;
    }
    return next();
});

/**
 * Middleware that requires a logged-in, active player. Adds `user` (their Better Auth
 * account) to the context. Throws 401 otherwise.
 */
export const loggedIn = api.middleware(async ({ context, next }) => {
    const session = await currentSession(context.auth, context.request);
    if (!session) throw apiError(401, "Please log in to continue.");
    return next({ context: { user: session.user } });
});

/**
 * Middleware that limits sign-up and log-in attempts per IP address. Throws 429, with
 * a Retry-After header, once an address goes over the limit.
 */
export const accountRateLimit = api.middleware(({ context, next }) => {
    if (!context.allowAccountAttempt(context.request.socket.remoteAddress)) {
        context.resHeaders?.set("Retry-After", "60");
        throw apiError(429, "Too many attempts. Please wait a minute and try again.");
    }
    return next();
});
