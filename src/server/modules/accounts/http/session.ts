// Express rate limiting for the website server. API sessions and same-website checks
// are handled by oRPC middleware in BackEnd/oRPC/base.ts.

import type { IncomingMessage } from "node:http";
import type { RequestHandler, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth, AuthUser } from "../infrastructure/betterAuth.ts";
import { httpError } from "../../../http/http.ts";

/**
 * Creates middleware that allows each IP address a set number of requests per minute.
 * @param maximum - The number of requests allowed per IP address each minute.
 * @returns Middleware that sends 429, with a Retry-After header, once that request's IP
 * address has gone over the limit.
 */
export function rateLimiter(maximum: number): RequestHandler {
    const allow = createAttemptLimiter(maximum);
    return (request, response, next) => {
        if (allow(request.socket.remoteAddress)) return next();
        response.set("Retry-After", "60");
        next(httpError(429, "Too many attempts. Please wait a minute and try again."));
    };
}
