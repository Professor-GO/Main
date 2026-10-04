// Express helpers for player sessions and request safety: reading the logged-in player
// from Better Auth, passing Better Auth's cookies on, blocking other websites, and rate limiting.

import type { IncomingMessage } from "node:http";
import type { RequestHandler, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth, AuthUser } from "../infrastructure/betterAuth.ts";
import { httpError } from "../../../http/http.ts";

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
 * Each cookie gets its own Set-Cookie header.
 * @param response - The response to send.
 * @param headers - The headers Better Auth returned.
 */
export function sendAuthCookies(response: Response, headers: Headers): void {
    for (const cookie of headers.getSetCookie()) response.append("Set-Cookie", cookie);
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
 * Gets the logged-in player for a request.
 * @param auth - The Better Auth instance.
 * @param request - The incoming request, carrying the session cookie.
 * @returns A promise for the player's account.
 * @throws HttpError 401 if there is no valid session, or the account is inactive.
 */
export async function requireUser(auth: Auth, request: IncomingMessage): Promise<AuthUser> {
    const session = await currentSession(auth, request);
    if (!session) throw httpError(401, "Please log in to continue.");
    return session.user;
}

/**
 * Middleware that blocks requests sent from other websites, so another site cannot act
 * on a player's account using their cookie. Sends 403 for cross-site requests.
 */
export const checkOrigin: RequestHandler = (request, _response, next) => {
    const blocked = httpError(403, "Use this website to manage your account.");
    if (request.headers["sec-fetch-site"] === "cross-site") return next(blocked);
    if (request.headers.origin) {
        let host: string | undefined;
        try { host = new URL(request.headers.origin).host; } catch { /* Rejected below. */ }
        if (host !== request.headers.host) return next(blocked);
    }
    next();
};

/**
 * Creates middleware that allows each IP address a set number of requests per minute.
 * @param maximum - The number of requests allowed per IP address each minute.
 * @returns Middleware that sends 429, with a Retry-After header, once that request's IP
 * address has gone over the limit.
 */
export function rateLimiter(maximum: number): RequestHandler {
    const attempts = new Map<string | undefined, { count: number; until: number }>();
    return (request, response, next) => {
        const now = Date.now();
        for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
        const key = request.socket.remoteAddress;
        const entry = attempts.get(key) ?? { count: 0, until: now + 60_000 };
        attempts.set(key, entry);
        if (++entry.count <= maximum) return next();
        response.set("Retry-After", "60");
        next(httpError(429, "Too many attempts. Please wait a minute and try again."));
    };
}
