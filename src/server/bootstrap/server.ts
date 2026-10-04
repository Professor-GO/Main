// Starts both production listeners, or only the API for Vite development.

import { createServer } from "node:http";
import type { Server } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { openDatabase } from "../storage/database.ts";
import { createAuth } from "../modules/accounts/infrastructure/betterAuth.ts";
import { createBackendApp } from "../http/apiApp.ts";
import { createFrontendApp } from "../http/websiteApp.ts";
import { loadAssets } from "./assets.ts";
import { readConfig } from "./config.ts";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const servers: Server[] = [];
let database: DatabaseSync | undefined;

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

    const apiOnly = process.argv.includes("--api-only");
    const backend = createBackendApp({ db, auth, environment });
    const listeners = [{ app: backend, host: backendHost, port: backendPort }];
    if (!apiOnly) {
        const frontend = createFrontendApp({ assets: await loadAssets(resolve(projectRoot, "dist/client")), backendHost: backendConnectHost, backendPort });
        listeners.push({ app: frontend, host: frontendHost, port: frontendPort });
    }

    for (const { app, host, port } of listeners) {
        const server = createServer(app);
        servers.push(server);
        await new Promise<void>((done, reject) => {
            server.once("error", reject);
            server.listen(port, host, done);
        });
    }
    console.log(`Professor-Go (${environment})`);
    if (!apiOnly) console.log(`Website: http://${displayHost}:${frontendPort}`);
    console.log(`Backend port: ${backendPort} | SQLite accounts ready`);
    console.log(`Press Ctrl+C to stop ${apiOnly ? "the API server" : "both servers"}.`);
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
