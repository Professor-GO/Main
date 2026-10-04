// Every API procedure, grouped by feature. This object is the whole API: handler.ts
// serves it over HTTP, and its type (ApiRouter) can give a frontend a fully typed client.
//
// To add an endpoint: write a procedure with api.route({ method, path }) in procedures/,
// then add it here. Paths are relative to /api.

import { api } from "./base.ts";
import { login, logout, me, register } from "./procedures/auth.ts";
import { inventory, levelUp, pool, pull } from "./procedures/gacha.ts";
import { answer, question } from "./procedures/question.ts";

// GET /api/health: reports that the server and database are working.
const health = api
    .route({ method: "GET", path: "/health" })
    .meta({ allowHead: true })
    .handler(({ context }) => {
        context.db.prepare("SELECT 1").get();
        return { status: "ok", environment: context.environment, database: "connected" };
    });

export const router = {
    health,
    auth: { me, register, login, logout },
    gacha: { pool, pull },
    inventory: { list: inventory, levelUp },
    question: { get: question, answer },
};

/** The API's type, for building a typed oRPC client. */
export type ApiRouter = typeof router;
