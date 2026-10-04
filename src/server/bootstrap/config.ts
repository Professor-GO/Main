/** Validates startup settings while keeping database paths independent of source layout. */
import { resolve } from "node:path";
import { DEVELOPMENT_SECRET } from "../modules/accounts/infrastructure/betterAuth.ts";

export type ServerConfig = {
    environment: string;
    production: boolean;
    frontendHost: string;
    frontendPort: number;
    backendHost: string;
    backendPort: number;
    backendConnectHost: string;
    databasePath: string;
    secret: string;
    baseURL: string;
};

/**
 * Reads and validates the existing server settings without opening storage.
 * @param root Repository root used for relative database overrides.
 * @param env Environment settings supplied by the composition root.
 * @returns Validated startup settings with the server storage database default.
 */
export function readConfig(root: string, env: NodeJS.ProcessEnv): ServerConfig {
    const environment = env.APP_ENV ?? "development";
    if (!["development", "test", "production"].includes(environment)) {
        throw new Error("APP_ENV must be development, test, or production.");
    }
    const production = environment === "production";
    const frontendHost = env.FRONTEND_HOST ?? "127.0.0.1";
    const frontendPort = portSetting(env, "FRONTEND_PORT", 3000);
    const backendHost = env.BACKEND_HOST ?? "127.0.0.1";
    const backendPort = portSetting(env, "BACKEND_PORT", 3001);
    const backendConnectHost = backendHost === "0.0.0.0" ? "127.0.0.1" : backendHost === "::" ? "::1" : backendHost;
    const secret = env.BETTER_AUTH_SECRET?.trim() || (production ? "" : DEVELOPMENT_SECRET);
    if (!secret) throw new Error("Set BETTER_AUTH_SECRET in .env to a long random value before running in production.");
    const displayHost = frontendHost.includes(":") ? `[${frontendHost}]` : frontendHost;
    const baseURL = env.BETTER_AUTH_URL?.trim() || `http://${displayHost}:${frontendPort}`;
    return {
        environment, production, frontendHost, frontendPort, backendHost, backendPort,
        backendConnectHost, secret, baseURL,
        databasePath: resolve(root, env.DATABASE_PATH ?? "src/server/storage/data/game.sqlite"),
    };
}

/** Preserves the existing decimal integer port validation and error wording. */
function portSetting(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
    const value = env[name] ?? String(fallback);
    const port = Number(value);
    if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
        throw new Error(`${name} must be an integer between 1 and 65535.`);
    }
    return port;
}
