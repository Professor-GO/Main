// The backend Express app. Every /api/ endpoint is an oRPC procedure (see BackEnd/oRPC/);
// Express adds the security headers, the 404 for unknown paths, and error replies.
// The website reaches it through the frontend app's proxy (see frontend.ts).

import type { DatabaseSync } from "node:sqlite";
import type express from "express";
import type { Auth } from "../Persistence Layer/auth.ts";
import { initializeQuestions } from "../Persistence Layer/questions.ts";
import { orpcMiddleware } from "../oRPC/handler.ts";
import { createAttemptLimiter } from "../rate-limit.ts";
import { createApp, errorHandler, notFound } from "./http.ts";

/** What the API needs from server.ts. */
export type AppContext = {
    // The open game database.
    db: DatabaseSync;
    // Better Auth, which handles accounts, passwords, and sessions in the persistence layer.
    auth: Auth;
    // The APP_ENV setting: "development", "test", or "production".
    environment: string;
};

/**
 * Creates the backend app with every API procedure. Unknown paths get 404 and wrong
 * methods get 405; errors are sent as JSON `{ message }`.
 * @param context - The database and settings the procedures use.
 * @returns The app, ready to pass to http.createServer().
 */
export function createBackendApp({ db, auth, environment }: AppContext): express.Express {
    initializeQuestions(db);
    // Generous limit for the backend itself; the website adds a stricter one per player.
    const allowAccountAttempt = createAttemptLimiter(500);
    const app = createApp();
    app.use(orpcMiddleware((request) => ({ request, db, auth, environment, allowAccountAttempt })));
    app.use(notFound);
    app.use(errorHandler);
    return app;
}
