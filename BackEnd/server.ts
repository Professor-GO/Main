import { createServer, request as proxyRequest } from "node:http";
import type { IncomingMessage, OutgoingHttpHeaders, Server, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
    openDatabase, hashPassword, verifyPassword, publicUser,
    createSession, sessionUser, tokenHash, SESSION_SECONDS,
    userById, userByUsername,
} from "./database.ts";
import type { UserRow } from "./database.ts";
import { GACHA_POOL, PULL_COST, pullProfessor } from "./Professor Gacha System/gacha.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const servers: Server[] = [];
let database: DatabaseSync | undefined;

/**
 * Reads a port number from an environment variable.
 * @param name - The environment variable to read, such as "FRONTEND_PORT".
 * @param fallback - The port to use when the variable is not set.
 * @returns The port number.
 * @throws Error if the value is not a whole number from 1 to 65535.
 */
function portSetting(name: string, fallback: number): number {
    const value = process.env[name] ?? String(fallback);
    const port = Number(value);
    if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
        throw new Error(`${name} must be an integer between 1 and 65535.`);
    }
    return port;
}

/**
 * Sends an HTTP response with the app's standard security and no-caching headers.
 * @param response - The response to send.
 * @param status - The HTTP status code, such as 200 or 404.
 * @param body - An object (sent as JSON), or a string or Buffer (sent as-is).
 * @param method - The request's method. HEAD requests get headers only, with no body.
 * @param contentType - The Content-Type header. Defaults to JSON.
 */
function reply(response: ServerResponse, status: number, body: object | string, method = "GET", contentType = "application/json; charset=utf-8"): void {
    response.writeHead(status, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
        "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    response.end(method === "HEAD" ? undefined : typeof body === "string" || Buffer.isBuffer(body)
        ? body : JSON.stringify(body));
}

/** An error whose message is safe to show to the player, with the HTTP status to send. */
class HttpError extends Error {
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
function httpError(status: number, message: string): HttpError {
    return new HttpError(status, message);
}

/**
 * Sends an error response as JSON `{ message }`. HttpErrors send their own status and
 * message; any other error is logged and sent as a generic 500 so internal details stay private.
 * @param response - The response to send.
 * @param error - The error that was thrown.
 * @param method - The request's method. HEAD requests get headers only, with no body.
 */
function replyError(response: ServerResponse, error: unknown, method = "GET"): void {
    if (!(error instanceof HttpError)) console.error(error);
    reply(response, error instanceof HttpError ? error.status : 500, {
        message: error instanceof HttpError ? error.message : "Something went wrong. Please try again.",
    }, method);
}

/**
 * Reads and parses a request's JSON body, limited to 8 KB.
 * @param request - The incoming request.
 * @returns A promise for the parsed JSON object.
 * @throws HttpError 415 if the body is not JSON, 413 if it is too large, or 400 if
 * it is not a valid JSON object.
 */
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
    if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
        throw httpError(415, "Send the request as JSON.");
    }
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const data of request.iterator({ destroyOnReturn: false })) {
        const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
        size += chunk.length;
        if (size > 8192) {
            request.resume();
            throw httpError(413, "This request is too large.");
        }
        chunks.push(chunk);
    }
    try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
        return body as Record<string, unknown>;
    } catch {
        throw httpError(400, "Send a valid JSON object.");
    }
}

/**
 * Gets the session token from the request's "arena_session" cookie.
 * @param request - The incoming request.
 * @returns The raw session token, or undefined if the cookie is missing.
 */
function requestToken(request: IncomingMessage): string | undefined {
    return request.headers.cookie?.split(";")
        .map((part) => part.trim()).find((part) => part.startsWith("arena_session="))?.slice(14);
}

/**
 * Sets the session cookie on a response. Passing an empty token deletes the cookie.
 * @param response - The response to add the cookie to.
 * @param token - The raw session token, or "" to log the browser out.
 * @param production - When true, the cookie is marked Secure (HTTPS only).
 */
function setSessionCookie(response: ServerResponse, token: string, production: boolean): void {
    response.setHeader("Set-Cookie", `arena_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token ? SESSION_SECONDS : 0}${production ? "; Secure" : ""}`);
}

/**
 * Blocks requests sent from other websites, so another site cannot act on a
 * player's account using their cookie.
 * @param request - The incoming request.
 * @throws HttpError 403 if the request came from a different website.
 */
function checkOrigin(request: IncomingMessage): void {
    if (request.headers["sec-fetch-site"] === "cross-site") throw httpError(403, "Use this website to manage your account.");
    if (request.headers.origin) {
        let host: string | undefined;
        try { host = new URL(request.headers.origin).host; } catch { /* Rejected below. */ }
        if (host !== request.headers.host) throw httpError(403, "Use this website to manage your account.");
    }
}

/**
 * Creates a limiter that allows each IP address a set number of requests per minute.
 * @param maximum - The number of requests allowed per IP address each minute.
 * @returns A function to call on each request. It throws HttpError 429 once that
 * request's IP address has gone over the limit.
 */
function rateLimiter(maximum: number): (request: IncomingMessage) => void {
    const attempts = new Map<string | undefined, { count: number; until: number }>();
    return (request: IncomingMessage) => {
        const now = Date.now();
        for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
        const key = request.socket.remoteAddress;
        const entry = attempts.get(key) ?? { count: 0, until: now + 60_000 };
        attempts.set(key, entry);
        if (++entry.count > maximum) throw httpError(429, "Too many attempts. Please wait a minute and try again.");
    };
}

/**
 * Starts Professor-Go: loads settings from .env, opens the database, reads the
 * website files, and starts the frontend and backend servers.
 * @returns A promise that resolves once both servers are listening.
 */
async function main(): Promise<void> {
    try { loadEnvFile(resolve(projectRoot, ".env")); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }

    const environment = process.env.APP_ENV ?? "development";
    if (!["development", "test", "production"].includes(environment)) {
        throw new Error("APP_ENV must be development, test, or production.");
    }
    const production = environment === "production";
    const frontendHost = process.env.FRONTEND_HOST ?? "127.0.0.1";
    const frontendPort = portSetting("FRONTEND_PORT", 3000);
    const backendHost = process.env.BACKEND_HOST ?? "127.0.0.1";
    const backendPort = portSetting("BACKEND_PORT", 3001);
    const backendConnectHost = backendHost === "0.0.0.0" ? "127.0.0.1" : backendHost === "::" ? "::1" : backendHost;
    const db = openDatabase(resolve(projectRoot, process.env.DATABASE_PATH ?? "BackEnd/data/game.sqlite"));
    database = db;
    const dummyHash = await hashPassword("unused-account-placeholder");
    const backendLimit = rateLimiter(500);
    const frontendLimit = rateLimiter(60);

    const assets = new Map<string, { contentType: string; body: Buffer }>();
    for (const [path, filename, contentType] of [
        ["/", "index.html", "text/html; charset=utf-8"],
        ["/styles.css", "styles.css", "text/css; charset=utf-8"],
        ["/app.js", "app.js", "text/javascript; charset=utf-8"],
        ["/favicon.svg", "favicon.svg", "image/svg+xml"],
    ] as const) {
        assets.set(path, { contentType, body: await readFile(resolve(projectRoot, "FrontEnd", filename)) });
    }

    // Backend server: handles every /api/ route. Each route checks its method,
    // then either replies with JSON or throws an HttpError that replyError() sends.
    const backend = createServer(async (request, response) => {
        try {
            const path = request.url?.split("?")[0] ?? "";
            const methods: Record<string, string[]> = {
                "/api/health": ["GET", "HEAD"],
                "/api/auth/me": ["GET"],
                "/api/auth/register": ["POST"],
                "/api/auth/login": ["POST"],
                "/api/auth/logout": ["POST"],
                "/api/gacha/pool": ["GET"],
                "/api/gacha/pull": ["POST"],
            };
            if (!Object.hasOwn(methods, path)) throw httpError(404, "Not found.");
            if (!methods[path].includes(request.method ?? "")) {
                response.setHeader("Allow", methods[path].join(", "));
                throw httpError(405, "Method not allowed.");
            }
            if (path === "/api/health") {
                db.prepare("SELECT 1").get();
                return reply(response, 200, { status: "ok", environment, database: "connected" }, request.method);
            }
            if (path === "/api/gacha/pool") {
                return reply(response, 200, { cost: PULL_COST, professors: GACHA_POOL });
            }
            if (path === "/api/auth/me") {
                const user = sessionUser(db, requestToken(request));
                if (!user) {
                    setSessionCookie(response, "", production);
                    throw httpError(401, "Please log in to continue.");
                }
                return reply(response, 200, { user: publicUser(user) });
            }
            checkOrigin(request);
            const body = await readJson(request);
            if (path === "/api/auth/logout") {
                const token = requestToken(request);
                if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
                setSessionCookie(response, "", production);
                return reply(response, 200, { message: "You have been logged out." });
            }
            if (path === "/api/gacha/pull") {
                const user = sessionUser(db, requestToken(request));
                if (!user) throw httpError(401, "Please log in to continue.");
                const pull = pullProfessor(db, user.id);
                if (!pull) throw httpError(409, `You need ${PULL_COST} tokens to recruit a professor.`);
                return reply(response, 200, { professor: pull.professor, user: publicUser({ ...user, tokens: pull.tokens }) });
            }
            backendLimit(request);
            const username = typeof body.username === "string" ? body.username.trim() : "";
            const password = body.password;
            if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
                throw httpError(400, "Your username needs 3–20 letters, numbers, or underscores.");
            }
            if (typeof password !== "string" || password.length < 8 || password.length > 128) {
                throw httpError(400, "Your password needs 8–128 characters.");
            }
            let user: UserRow | undefined;
            if (path === "/api/auth/register") {
                const passwordHash = await hashPassword(password);
                const inserted = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?) ON CONFLICT(username) DO NOTHING")
                    .run(username, passwordHash);
                if (!inserted.changes) throw httpError(409, "That username is taken. Try another one.");
                user = userById(db, inserted.lastInsertRowid);
                if (!user) throw new Error("Could not load the new account.");
            } else {
                user = userByUsername(db, username);
                const valid = await verifyPassword(password, user?.password_hash ?? dummyHash);
                if (!user || !valid) throw httpError(401, "That username and password do not match.");
                user = userById(db, user.id);
                if (!user?.is_active) throw httpError(403, "This account is inactive. Contact the game organizers.");
            }
            const oldToken = requestToken(request);
            if (oldToken) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(oldToken));
            setSessionCookie(response, createSession(db, user.id), production);
            reply(response, path === "/api/auth/register" ? 201 : 200, { user: publicUser(user) });
        } catch (error) {
            replyError(response, error, request.method);
        }
    });

    // Frontend server: forwards /api/ requests to the backend, and serves the
    // allowlisted website files for everything else.
    const frontend = createServer((request, response) => {
        const path = request.url?.split("?")[0] ?? "";
        if (path?.startsWith("/api/")) {
            try {
                if (["/api/auth/login", "/api/auth/register"].includes(path)) frontendLimit(request);
            } catch (error) {
                request.resume();
                response.setHeader("Retry-After", "60");
                return replyError(response, error, request.method);
            }
            // Preserve the browser's Host for origin checks and forward session cookies.
            const headers: OutgoingHttpHeaders = { host: request.headers.host };
            for (const name of ["content-type", "content-length", "cookie", "origin", "sec-fetch-site"]) {
                if (request.headers[name]) headers[name] = request.headers[name];
            }
            const upstream = proxyRequest({
                hostname: backendConnectHost, port: backendPort, path: request.url,
                method: request.method, headers, timeout: 10_000,
            }, (incoming) => {
                response.writeHead(incoming.statusCode ?? 502, incoming.headers);
                incoming.pipe(response);
            });
            upstream.on("timeout", () => upstream.destroy(new Error("Backend timeout")));
            upstream.on("error", () => {
                if (!response.headersSent) reply(response, 502, { message: "The game server is unavailable. Please try again shortly." });
                else response.end();
            });
            request.on("aborted", () => upstream.destroy());
            request.pipe(upstream);
            return;
        }
        if (!["GET", "HEAD"].includes(request.method ?? "")) {
            response.setHeader("Allow", "GET, HEAD");
            return reply(response, 405, { message: "Method not allowed." });
        }
        const asset = assets.get(path);
        if (!asset) return reply(response, 404, "Not found", request.method, "text/plain");
        reply(response, 200, asset.body, request.method, asset.contentType);
    });

    for (const [server, host, port] of [[backend, backendHost, backendPort], [frontend, frontendHost, frontendPort]] as const) {
        servers.push(server);
        await new Promise<void>((done, reject) => {
            server.once("error", reject);
            server.listen(port, host, done);
        });
    }
    const displayHost = frontendHost.includes(":") ? `[${frontendHost}]` : frontendHost;
    console.log(`Professor-Go (${environment})`);
    console.log(`Website: http://${displayHost}:${frontendPort}`);
    console.log(`Backend port: ${backendPort} | SQLite accounts ready`);
    console.log("Press Ctrl+C to stop both servers.");
}

/** Shuts down both servers and closes the database. Safe to call more than once. */
function stop(): void {
    for (const server of servers) { server.close(); server.closeAllConnections(); }
    database?.close();
    database = undefined;
}
process.once("SIGINT", () => { stop(); process.exit(0); });
process.once("SIGTERM", () => { stop(); process.exit(0); });
main().catch((error: unknown) => {
    console.error(`Could not start Professor-Go: ${error instanceof Error ? error.message : String(error)}`);
    stop();
    process.exitCode = 1;
});
