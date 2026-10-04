// Serves the oRPC router over HTTP inside the backend Express app.
//
// oRPC's OpenAPIHandler answers each procedure at its REST path, such as POST
// /api/auth/login, so the website calls the API with plain fetch(). Before a request
// reaches oRPC, this file:
//   - only lets exact procedure paths through ("/api/health/" or "/API/health" get 404),
//   - answers a known path with the wrong method with 405 and an Allow header,
//   - answers HEAD for procedures marked .meta({ allowHead: true }),
//   - reads JSON bodies with the size and type limits from Express/http.ts.

import { ORPCError, ValidationError, onError } from "@orpc/server";
import { ResponseHeadersPlugin } from "@orpc/server/plugins";
import { OpenAPIHandler } from "@orpc/openapi/node";
import type { RequestHandler } from "express";
import { httpError, jsonBody } from "../Express/http.ts";
import type { ApiContext, ApiMeta } from "./base.ts";
import { router } from "./router.ts";

// Every procedure's path (with /api) and the methods it answers.
type RouteInfo = { methods: string[] };

/**
 * Lists every procedure in the router with its full path and allowed methods.
 * @param node - The router, or part of it.
 * @param routes - The table being filled in.
 * @returns The table, keyed by path such as "/api/auth/login".
 */
function routeTable(node: object, routes = new Map<string, RouteInfo>()): Map<string, RouteInfo> {
    for (const value of Object.values(node)) {
        if (value && typeof value === "object" && "~orpc" in value) {
            const { route, meta } = (value as { "~orpc": { route: { method?: string; path?: string }; meta: ApiMeta } })["~orpc"];
            if (!route.method || !route.path) throw new Error("Every API procedure needs .route({ method, path }).");
            const path = `/api${route.path}`;
            const methods = routes.get(path)?.methods ?? [];
            methods.push(route.method, ...(route.method === "GET" && meta.allowHead ? ["HEAD"] : []));
            routes.set(path, { methods });
        } else if (value && typeof value === "object") {
            routeTable(value, routes);
        }
    }
    return routes;
}

const ROUTES = routeTable(router);

const handler = new OpenAPIHandler(router, {
    // Lets procedures add response headers, such as Better Auth's Set-Cookie.
    plugins: [new ResponseHeadersPlugin()],
    // Errors are sent as `{ message }`. For invalid input, the message is the first rule
    // that failed (for example "Your password needs 8–128 characters.").
    customErrorResponseBodyEncoder: (error) => {
        const issue = error.cause instanceof ValidationError ? error.cause.issues[0] : undefined;
        return { message: issue?.message ?? error.message };
    },
    // Log unexpected errors. Player-facing errors (4xx) are expected and not logged.
    clientInterceptors: [onError((error) => {
        if (!(error instanceof ORPCError) || error.status >= 500) console.error(error);
    })],
});

/**
 * Creates Express middleware that serves the API with oRPC.
 * @param context - Builds each request's oRPC context (database, Better Auth, settings).
 * @returns The middleware. Requests that are not API procedures are passed on (404).
 */
export function orpcMiddleware(context: (request: Parameters<RequestHandler>[0]) => Omit<ApiContext, "resHeaders">): RequestHandler {
    return (request, response, next) => {
        const route = ROUTES.get(request.path);
        if (!route) return next();
        if (!route.methods.includes(request.method)) {
            response.set("Allow", route.methods.join(", "));
            return next(httpError(405, "Method not allowed."));
        }
        const serve = async () => {
            // Node already knows this is a HEAD request and will send headers only; oRPC
            // matches procedures by GET.
            if (request.method === "HEAD") request.method = "GET";
            const { matched } = await handler.handle(request, response, { prefix: "/api", context: context(request) });
            if (!matched) next();
        };
        if (request.method !== "POST") return void serve().catch(next);
        jsonBody(request, response, (error?: unknown) => error ? next(error) : void serve().catch(next));
    };
}
