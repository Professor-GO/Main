// Starts Professor-Go: two Express apps, a frontend that serves the website and a
// backend with the API. The routes and middleware live in BackEnd/Express/.

import { createServer } from "node:http";
import type { Server } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { DEFAULT_DATABASE_PATH, openDatabase } from "./Persistence Layer/database.ts";
import { createAuth, DEVELOPMENT_SECRET } from "./Persistence Layer/auth.ts";
import { createBackendApp } from "./Express/backend.ts";
import { createFrontendApp } from "./Express/frontend.ts";
import type { Asset } from "./Express/frontend.ts";

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
 * Reads the website files into memory. Only these paths are ever served.
 * @returns The files by the path they are served at.
 */
async function loadAssets(): Promise<Map<string, Asset>> {
    const assets = new Map<string, Asset>();
    for (const [path, filename, contentType] of [
        ["/", "index.html", "text/html; charset=utf-8"],
        ["/styles.css", "styles.css", "text/css; charset=utf-8"],
        ["/app.js", "app.js", "text/javascript; charset=utf-8"],
        ["/favicon.svg", "favicon.svg", "image/svg+xml"],
    ] as const) {
        assets.set(path, { contentType, body: await readFile(resolve(projectRoot, "FrontEnd", filename)) });
    }
    return assets;
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
    // Production needs a real BETTER_AUTH_SECRET and marks session cookies Secure (HTTPS only).
    const production = environment === "production";
    const frontendHost = process.env.FRONTEND_HOST ?? "127.0.0.1";
    const frontendPort = portSetting("FRONTEND_PORT", 3000);
    const backendHost = process.env.BACKEND_HOST ?? "127.0.0.1";
    const backendPort = portSetting("BACKEND_PORT", 3001);
    // A server listening on every address is reached through the local one.
    const backendConnectHost = backendHost === "0.0.0.0" ? "127.0.0.1" : backendHost === "::" ? "::1" : backendHost;
    // Better Auth signs session cookies with this secret. Production must set its own.
    const secret = process.env.BETTER_AUTH_SECRET?.trim() || (production ? "" : DEVELOPMENT_SECRET);
    if (!secret) throw new Error("Set BETTER_AUTH_SECRET in .env to a long random value before running in production.");
    const displayHost = frontendHost.includes(":") ? `[${frontendHost}]` : frontendHost;
    const baseURL = process.env.BETTER_AUTH_URL?.trim() || `http://${displayHost}:${frontendPort}`;

    const db = openDatabase(resolve(projectRoot, process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH));
    database = db;
    const auth = await createAuth(db, { baseURL, secret, production });

    const backend = createBackendApp({ db, auth, environment });
    const frontend = createFrontendApp({ assets: await loadAssets(), backendHost: backendConnectHost, backendPort });

    for (const [app, host, port] of [[backend, backendHost, backendPort], [frontend, frontendHost, frontendPort]] as const) {
        const server = createServer(app);
        servers.push(server);
        await new Promise<void>((done, reject) => {
            server.once("error", reject);
            server.listen(port, host, done);
        });
    }
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
