// Express helpers shared by the backend and frontend servers: player-safe errors,
// standard headers, JSON body reading, and the 404, 405 and error replies.

import express from "express";
import type { ErrorRequestHandler, RequestHandler } from "express";

// The largest JSON body the API accepts, in bytes.
const MAX_BODY_BYTES = 8192;

/** An error whose message is safe to show to the player, with the HTTP status to send. */
export class HttpError extends Error {
    status: number;

    /**
     * @param status - The HTTP status code to send, such as 400 or 401.
     * @param message - The message shown to the player.
     */
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

/**
 * Shorthand for creating an HttpError, so request handlers can `throw httpError(...)`.
 * @param status - The HTTP status code to send.
 * @param message - The message shown to the player.
 * @returns The new HttpError.
 */
export function httpError(status: number, message: string): HttpError {
    return new HttpError(status, message);
}

/**
 * Creates an Express app with the settings both servers share: exact route matching
 * ("/api/auth/me" only, not "/API/auth/me/"), and no X-Powered-By or ETag headers.
 * @returns The new app.
 */
export function createApp(): express.Express {
    const app = express();
    app.set("case sensitive routing", true);
    app.set("strict routing", true);
    app.set("etag", false);
    app.disable("x-powered-by");
    app.use(securityHeaders);
    return app;
}

/**
 * Creates an Express router with the same exact route matching as createApp(). Routers
 * do not inherit the app's settings, so every router should be made with this.
 * @returns The new router.
 */
export function createRouter(): express.Router {
    return express.Router({ caseSensitive: true, strict: true });
}

/**
 * Middleware that adds the app's standard security and no-caching headers to every response.
 * Routes can still replace Content-Type.
 */
export const securityHeaders: RequestHandler = (_request, response, next) => {
    response.set({
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
        "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    next();
};

/**
 * Middleware that only lets the listed HTTP methods through. Express answers HEAD with
 * GET routes by default, so HEAD must be listed to be allowed.
 * @param methods - The allowed methods, such as ["GET", "HEAD"].
 * @returns Middleware that sends 405 with an Allow header for any other method.
 */
export function allowMethods(...methods: string[]): RequestHandler {
    return (request, response, next) => {
        if (methods.includes(request.method)) return next();
        response.set("Allow", methods.join(", "));
        next(httpError(405, "Method not allowed."));
    };
}

// Reads JSON bodies up to MAX_BODY_BYTES. Only objects and arrays are accepted.
const parseJson = express.json({ limit: MAX_BODY_BYTES, strict: true, type: "application/json" });

/**
 * Middleware that reads the request's JSON body into request.body.
 * Errors: 415 if the body is not JSON, 413 if it is larger than 8 KB, and 400 if it is
 * not a valid JSON object (arrays and null are rejected too).
 */
export const jsonBody: RequestHandler = (request, response, next) => {
    const type = request.headers["content-type"]?.split(";")[0].trim();
    if (type !== "application/json") return next(httpError(415, "Send the request as JSON."));
    parseJson(request, response, (error?: unknown) => {
        if (error) return next(error);
        const body: unknown = request.body;
        next(body && typeof body === "object" && !Array.isArray(body) ? undefined : httpError(400, "Send a valid JSON object."));
    });
};

/** Middleware for unknown routes: sends 404 `{ message }`. */
export const notFound: RequestHandler = (_request, _response, next) => {
    next(httpError(404, "Not found."));
};

/**
 * Express error handler: sends errors as JSON `{ message }`. HttpErrors send their own
 * status and message, and body-reading errors get a matching player-safe message. Any
 * other error is logged and sent as a generic 500 so internal details stay private.
 */
export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    // Too late to send an error reply; let Express close the connection.
    if (response.headersSent) return next(error);
    let status = 500;
    let message = "Something went wrong. Please try again.";
    if (error instanceof HttpError) {
        ({ status, message } = error);
    } else if (isBodyError(error)) {
        status = error.status;
        message = status === 413 ? "This request is too large."
            : status === 415 ? "Send the request as JSON."
            : "Send a valid JSON object.";
    } else {
        console.error(error);
    }
    response.status(status).json({ message });
};

/**
 * Checks whether an error came from express.json() reading a request body, such as
 * malformed JSON (type "entity.parse.failed") or a body that is too large ("entity.too.large").
 * @param error - The error that was thrown.
 * @returns True for body-reading errors with a 4xx status.
 */
function isBodyError(error: unknown): error is { status: number; type: string } {
    if (!error || typeof error !== "object") return false;
    const { status, type } = error as { status?: unknown; type?: unknown };
    return typeof type === "string" && typeof status === "number" && status >= 400 && status < 500;
}
