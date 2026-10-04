// Starts Professor-Go: two Express apps, a frontend that serves the website and a
// backend with the API. The routes and middleware live in BackEnd/Express/.

import { createServer } from "node:http";
import type { Server } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { openDatabase } from "../storage/database.ts";
import { createAuth } from "../modules/accounts/infrastructure/betterAuth.ts";
import { createBackendApp } from "../http/apiApp.ts";
import { createFrontendApp } from "../http/websiteApp.ts";
import type { Asset } from "../http/websiteApp.ts";
import { readConfig } from "./config.ts";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const servers: Server[] = [];
let database: DatabaseSync | undefined;

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

    const { environment, production, frontendHost, frontendPort, backendHost, backendPort,
        backendConnectHost, secret, baseURL, databasePath } = readConfig(projectRoot, process.env);
    const displayHost = frontendHost.includes(":") ? `[${frontendHost}]` : frontendHost;

    const db = openDatabase(databasePath);
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
