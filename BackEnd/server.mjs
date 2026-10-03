import { createServer, request as proxyRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
    openDatabase, hashPassword, verifyPassword, publicUser,
    createSession, sessionUser, tokenHash, SESSION_SECONDS,
} from "./database.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const servers = [];
let db;

function portSetting(name, fallback) {
    const value = process.env[name] ?? String(fallback);
    const port = Number(value);
    if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
        throw new Error(`${name} must be an integer between 1 and 65535.`);
    }
    return port;
}

function reply(response, status, body, method = "GET", contentType = "application/json; charset=utf-8") {
    response.writeHead(status, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
        "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    response.end(method === "HEAD" ? undefined : typeof body === "object" && !Buffer.isBuffer(body)
        ? JSON.stringify(body) : body);
}

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

async function readJson(request) {
    if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
        throw httpError(415, "Send the request as JSON.");
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > 8192) {
            request.resume();
            throw httpError(413, "This request is too large.");
        }
        chunks.push(chunk);
    }
    try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
        return body;
    } catch {
        throw httpError(400, "Send a valid JSON object.");
    }
}

function requestToken(request) {
    return request.headers.cookie?.split(";")
        .map((part) => part.trim()).find((part) => part.startsWith("arena_session="))?.slice(14);
}

function setSessionCookie(response, token, production) {
    response.setHeader("Set-Cookie", `arena_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token ? SESSION_SECONDS : 0}${production ? "; Secure" : ""}`);
}

function checkOrigin(request) {
    if (request.headers["sec-fetch-site"] === "cross-site") throw httpError(403, "Use this website to manage your account.");
    if (request.headers.origin) {
        let host;
        try { host = new URL(request.headers.origin).host; } catch { /* Rejected below. */ }
        if (host !== request.headers.host) throw httpError(403, "Use this website to manage your account.");
    }
}

function rateLimiter(maximum) {
    const attempts = new Map();
    return (request) => {
        const now = Date.now();
        for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
        const key = request.socket.remoteAddress;
        const entry = attempts.get(key) ?? { count: 0, until: now + 60_000 };
        attempts.set(key, entry);
        if (++entry.count > maximum) throw httpError(429, "Too many attempts. Please wait a minute and try again.");
    };
}

function fallbackCodingQuestion() {
    return {
        source: "fallback",
        topic: "arrays",
        difficulty: "medium",
        question: "Write a function that takes an array of professor names and returns a new array with duplicate names removed while preserving the original order.",
        hint: "Think about using a Set to remember which names you have already seen.",
    };
}

function parseGeminiQuestion(text) {
    const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const candidates = [trimmed, trimmed.match(/\{[\s\S]*\}/)?.[0]].filter(Boolean);
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (typeof parsed.question !== "string" || typeof parsed.topic !== "string" || typeof parsed.difficulty !== "string") {
                throw new Error("Gemini returned an incomplete question payload.");
            }
            return {
                source: "gemini",
                topic: parsed.topic.trim() || "general programming",
                difficulty: parsed.difficulty.trim() || "medium",
                question: parsed.question.trim(),
                hint: typeof parsed.hint === "string" ? parsed.hint.trim() : "",
            };
        } catch {
            // Try the next candidate.
        }
    }
    throw new Error("Gemini returned an unexpected question payload.");
}

async function createCodingQuestion() {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) return fallbackCodingQuestion();

    const configuredModel = process.env.GEMINI_MODEL?.trim();
    const models = [...new Set([
        configuredModel,
        "gemini-3.8-flash",
        "gemini-3.5-flash-lite",
        "gemini-2.5-flash",
    ])].filter(Boolean);
    for (const model of models) {
        try {
            const endpoint = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
            endpoint.searchParams.set("key", apiKey);

            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: "Generate one original coding question for a hackathon game about recruiting university professors. Return valid JSON with exactly these keys: question, topic, difficulty, hint. question should be one short paragraph, topic should be a concise programming topic, difficulty should be easy, medium, or hard, and hint should be a single sentence. Do not include markdown or code fences." }] }],
                    generationConfig: {
                        temperature: 0.8,
                        responseMimeType: "application/json",
                    },
                }),
                signal: AbortSignal.timeout(7_500),
            });

            if (!response.ok) continue;

            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
            if (!text) continue;
            return parseGeminiQuestion(text);
        } catch {
            continue;
        }
    }

    return fallbackCodingQuestion();
}

async function main() {
    try { loadEnvFile(resolve(projectRoot, ".env")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }

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
    db = openDatabase(resolve(projectRoot, process.env.DATABASE_PATH ?? "BackEnd/data/game.sqlite"));
    const dummyHash = await hashPassword("unused-account-placeholder");
    const backendLimit = rateLimiter(500);
    const frontendLimit = rateLimiter(60);

    const assets = new Map();
    for (const [path, filename, contentType] of [
        ["/", "index.html", "text/html; charset=utf-8"],
        ["/styles.css", "styles.css", "text/css; charset=utf-8"],
        ["/app.js", "app.js", "text/javascript; charset=utf-8"],
        ["/favicon.svg", "favicon.svg", "image/svg+xml"],
    ]) {
        assets.set(path, { contentType, body: await readFile(resolve(projectRoot, "FrontEnd", filename)) });
    }

    const backend = createServer(async (request, response) => {
        try {
            const path = request.url?.split("?")[0];
            const methods = {
                "/api/health": ["GET", "HEAD"],
                "/api/auth/me": ["GET"],
                "/api/auth/register": ["POST"],
                "/api/auth/login": ["POST"],
                "/api/auth/logout": ["POST"],
                "/api/question": ["GET"],
            };
            if (!Object.hasOwn(methods, path)) throw httpError(404, "Not found.");
            if (!methods[path].includes(request.method)) {
                response.setHeader("Allow", methods[path].join(", "));
                throw httpError(405, "Method not allowed.");
            }
            if (path === "/api/health") {
                db.prepare("SELECT 1").get();
                return reply(response, 200, { status: "ok", environment, database: "connected" }, request.method);
            }
            if (path === "/api/auth/me") {
                const user = sessionUser(db, requestToken(request));
                if (!user) {
                    setSessionCookie(response, "", production);
                    throw httpError(401, "Please log in to continue.");
                }
                return reply(response, 200, { user: publicUser(user) });
            }
            if (path === "/api/question") {
                checkOrigin(request);
                const user = sessionUser(db, requestToken(request));
                if (!user) throw httpError(401, "Please log in to continue.");
                try {
                    return reply(response, 200, await createCodingQuestion());
                } catch (error) {
                    const question = fallbackCodingQuestion();
                    question.message = "Gemini is temporarily unavailable, so this local question is being shown instead.";
                    return reply(response, 200, question);
                }
            }
            checkOrigin(request);
            const body = await readJson(request);
            if (path === "/api/auth/logout") {
                const token = requestToken(request);
                if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
                setSessionCookie(response, "", production);
                return reply(response, 200, { message: "You have been logged out." });
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
            let user;
            if (path === "/api/auth/register") {
                const passwordHash = await hashPassword(password);
                const inserted = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?) ON CONFLICT(username) DO NOTHING")
                    .run(username, passwordHash);
                if (!inserted.changes) throw httpError(409, "That username is taken. Try another one.");
                user = db.prepare("SELECT * FROM users WHERE id = ?").get(inserted.lastInsertRowid);
            } else {
                user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
                const valid = await verifyPassword(password, user?.password_hash ?? dummyHash);
                if (!user || !valid) throw httpError(401, "That username and password do not match.");
                user = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
                if (!user?.is_active) throw httpError(403, "This account is inactive. Contact the game organizers.");
            }
            const oldToken = requestToken(request);
            if (oldToken) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(oldToken));
            setSessionCookie(response, createSession(db, user.id), production);
            reply(response, path === "/api/auth/register" ? 201 : 200, { user: publicUser(user) });
        } catch (error) {
            if (!error.status) console.error(error);
            reply(response, error.status ?? 500, { message: error.status ? error.message : "Something went wrong. Please try again." }, request.method);
        }
    });

    const frontend = createServer((request, response) => {
        const path = request.url?.split("?")[0];
        if (path?.startsWith("/api/")) {
            try {
                if (["/api/auth/login", "/api/auth/register"].includes(path)) frontendLimit(request);
            } catch (error) {
                request.resume();
                response.setHeader("Retry-After", "60");
                return reply(response, error.status, { message: error.message });
            }
            // Preserve the browser's Host for origin checks and forward session cookies.
            const headers = { host: request.headers.host };
            for (const name of ["content-type", "content-length", "cookie", "origin", "sec-fetch-site"]) {
                if (request.headers[name]) headers[name] = request.headers[name];
            }
            const upstream = proxyRequest({
                hostname: backendConnectHost, port: backendPort, path: request.url,
                method: request.method, headers, timeout: 10_000,
            }, (incoming) => {
                response.writeHead(incoming.statusCode, incoming.headers);
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
        if (!["GET", "HEAD"].includes(request.method)) {
            response.setHeader("Allow", "GET, HEAD");
            return reply(response, 405, { message: "Method not allowed." });
        }
        const asset = assets.get(path);
        if (!asset) return reply(response, 404, "Not found", request.method, "text/plain");
        reply(response, 200, asset.body, request.method, asset.contentType);
    });

    for (const [server, host, port] of [[backend, backendHost, backendPort], [frontend, frontendHost, frontendPort]]) {
        servers.push(server);
        await new Promise((done, reject) => {
            server.once("error", reject);
            server.listen(port, host, done);
        });
    }
    const displayHost = frontendHost.includes(":") ? `[${frontendHost}]` : frontendHost;
    console.log(`Faculty Arena (${environment})`);
    console.log(`Website: http://${displayHost}:${frontendPort}`);
    console.log(`Backend port: ${backendPort} | SQLite accounts ready`);
    console.log("Press Ctrl+C to stop both servers.");
}

function stop() {
    for (const server of servers) { server.close(); server.closeAllConnections(); }
    db?.close();
    db = undefined;
}
process.once("SIGINT", () => { stop(); process.exit(0); });
process.once("SIGTERM", () => { stop(); process.exit(0); });
main().catch((error) => {
    console.error(`Could not start Faculty Arena: ${error.message}`);
    stop();
    process.exitCode = 1;
});
