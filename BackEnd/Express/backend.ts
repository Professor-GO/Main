// The backend Express app: every /api/ route. The website reaches it through the
// frontend app's proxy (see frontend.ts).

import type { DatabaseSync } from "node:sqlite";
import type express from "express";
import type { Auth } from "../Persistence Layer/auth.ts";
import { allowMethods, createApp, createRouter, errorHandler, notFound } from "./http.ts";
import { authRoutes } from "./routes/auth.ts";
import { gachaRoutes } from "./routes/gacha.ts";
import { questionRoutes } from "./routes/question.ts";

/** What the API routes need from server.ts. */
export type AppContext = {
    // The open game database.
    db: DatabaseSync;
    // Better Auth, which handles accounts, passwords, and sessions in the persistence layer.
    auth: Auth;
    // The APP_ENV setting: "development", "test", or "production".
    environment: string;
};

/**
 * Creates the backend app with every API route. Unknown routes get 404 and wrong methods
 * get 405; errors are sent as JSON `{ message }`.
 * @param context - The database and settings the routes use.
 * @returns The app, ready to pass to http.createServer().
 */
export function createBackendApp(context: AppContext): express.Express {
    const app = createApp();
    const health = createRouter();

    // Reports that the server and database are working.
    health.route("/health").all(allowMethods("GET", "HEAD")).get((_request, response) => {
        context.db.prepare("SELECT 1").get();
        response.json({ status: "ok", environment: context.environment, database: "connected" });
    });

    app.use("/api", health, authRoutes(context), gachaRoutes(context), questionRoutes(context));
    app.use(notFound);
    app.use(errorHandler);
    return app;
}
