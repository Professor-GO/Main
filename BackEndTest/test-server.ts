// Shared helpers for tests that call the API. Not a test file itself: `npm test` only
// runs files ending in .test.ts.
//
// startBackend() runs the real backend Express app inside the test process, on a free
// port, with a fresh in-memory database. It is faster than starting the whole game and
// needs no frontend build. Each call gets its own database, so tests cannot affect each other.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../BackEnd/Persistence Layer/database.ts";
import { createAuth } from "../BackEnd/Persistence Layer/auth.ts";
import type { Auth, PublicUser } from "../BackEnd/Persistence Layer/auth.ts";
import { createBackendApp } from "../BackEnd/Express/backend.ts";

/** Options for one API request. */
export type RequestOptions = {
    // JSON to send. Setting it makes the request a POST unless `method` says otherwise.
    body?: unknown;
    // A raw request body, sent as-is instead of `body` (for malformed or oversized bodies).
    rawBody?: string;
    // The session cookie to send, such as "professor-go.session_token=...".
    cookie?: string;
    // Extra request headers, such as { Origin: "https://another-site.example" }.
    headers?: Record<string, string>;
    // Overrides the HTTP method.
    method?: string;
};

/** A running test backend. */
export type TestBackend = {
    // The backend's address, such as "http://127.0.0.1:54321".
    url: string;
    // The backend's database, for checking what was saved.
    db: DatabaseSync;
    // The backend's Better Auth instance.
    auth: Auth;
    /**
     * Sends a request to the API.
     * @param path - The route after "/api/", such as "auth/register".
     * @param options - What to send.
     * @returns The response, its parsed JSON (typed as T), and the session cookie it set, if any.
     */
    api<T = Record<string, unknown>>(path: string, options?: RequestOptions): Promise<{ response: Response; data: T; cookie?: string }>;
    /**
     * Signs up a new player and returns their session cookie and account.
     * @param username - The username to sign up with.
     * @param password - The password; defaults to a valid one.
     * @returns The player's cookie and public account.
     */
    signUp(username: string, password?: string): Promise<{ cookie: string; user: PublicUser }>;
    /**
     * Reads a player's token balance straight from the database.
     * @param userId - The player's user id.
     * @returns Their balance.
     */
    tokensOf(userId: string): number;
    /** Stops the server and closes the database. */
    close(): Promise<void>;
};

// A valid password used when a test does not care which password it uses.
export const TEST_PASSWORD = "correct-horse-42";

/**
 * Starts the backend app on a free port with a fresh in-memory database.
 * @returns A promise for the running backend. Call close() when the test finishes.
 */
export async function startBackend(): Promise<TestBackend> {
    const db = openDatabase(":memory:");
    const auth = await createAuth(db, { baseURL: "http://127.0.0.1", secret: "test-secret-for-api-tests-only-0123456789", production: false });
    const server = createServer(createBackendApp({ db, auth, environment: "test" }));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const backend: TestBackend = {
        url, db, auth,
        async api<T>(path: string, { body, rawBody, cookie, headers = {}, method }: RequestOptions = {}) {
            const sending = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
            const response = await fetch(`${url}/api/${path}`, {
                method: method ?? (sending === undefined ? "GET" : "POST"),
                headers: { ...(sending === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
                body: sending,
            });
            const text = await response.text();
            const data = (text ? JSON.parse(text) : {}) as T;
            return { response, data, cookie: response.headers.getSetCookie()[0]?.split(";")[0] };
        },
        async signUp(username: string, password = TEST_PASSWORD) {
            const result = await backend.api<{ user: PublicUser }>("auth/register", { body: { username, password } });
            if (result.response.status !== 201 || !result.cookie) throw new Error(`Sign-up failed for ${username}: ${result.response.status}`);
            return { cookie: result.cookie, user: result.data.user };
        },
        tokensOf(userId: string) {
            return (db.prepare('SELECT tokens FROM "user" WHERE id = ?').get(userId) as { tokens: number }).tokens;
        },
        async close() {
            server.closeAllConnections();
            await new Promise<void>((done) => server.close(() => done()));
            db.close();
        },
    };
    return backend;
}
