// Express rate limiting for the website server. API sessions and same-website checks
// are handled by oRPC middleware in BackEnd/oRPC/base.ts.

import type { RequestHandler } from "express";
import { createAttemptLimiter } from "../rate-limit.ts";
import { httpError } from "./http.ts";

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
