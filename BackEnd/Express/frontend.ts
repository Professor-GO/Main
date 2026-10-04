// The frontend Express app: serves Vite's production build and forwards /api/ requests to
// the backend app, so the browser only ever talks to one address.

import { request as proxyRequest } from "node:http";
import type { OutgoingHttpHeaders } from "node:http";
import express from "express";
import { resolve } from "node:path";
import type { RequestHandler } from "express";
import { createApp, errorHandler, httpError } from "./http.ts";
import { rateLimiter } from "./session.ts";

/** Where the frontend app finds the website files and the backend. */
export type FrontendOptions = {
    // Vite's build output directory. Backend code and the database stay outside it.
    distDirectory: string;
    // The host and port the backend app listens on.
    backendHost: string;
    backendPort: number;
};

// Request headers passed on to the backend; all others are dropped.
const FORWARDED_HEADERS = ["content-type", "content-length", "cookie", "origin", "sec-fetch-site"];

/**
 * Creates middleware that forwards a request to the backend and streams the reply back.
 * The browser's Host header is kept so the backend's origin check sees the real website.
 * @param backendHost - The host the backend listens on.
 * @param backendPort - The port the backend listens on.
 * @returns The middleware. It sends 502 if the backend is down or takes over 10 seconds.
 */
function proxyToBackend(backendHost: string, backendPort: number): RequestHandler {
    return (request, response) => {
        const headers: OutgoingHttpHeaders = { host: request.headers.host };
        for (const name of FORWARDED_HEADERS) {
            if (request.headers[name]) headers[name] = request.headers[name];
        }
        const upstream = proxyRequest({
            hostname: backendHost, port: backendPort, path: request.originalUrl,
            method: request.method, headers, timeout: 10_000,
        }, (incoming) => {
            response.writeHead(incoming.statusCode ?? 502, incoming.headers);
            incoming.pipe(response);
        });
        upstream.on("timeout", () => upstream.destroy(new Error("Backend timeout")));
        upstream.on("error", () => {
            if (!response.headersSent) response.status(502).json({ message: "The game server is unavailable. Please try again shortly." });
            else response.end();
        });
        request.on("aborted", () => upstream.destroy());
        request.pipe(upstream);
    };
}

/**
 * Serves Vite's build and forwards API requests; only the build directory is public.
 * @param options - The build directory and the backend's address.
 * @returns The app, ready to pass to http.createServer().
 */
export function createFrontendApp({ distDirectory, backendHost, backendPort }: FrontendOptions): express.Express {
    const app = createApp();
    // A stricter limit than the backend's, so one player cannot hammer sign-up or log-in.
    const accountLimit = rateLimiter(60);

    app.use(["/api/auth/login", "/api/auth/register"], accountLimit);
    app.use("/api", proxyToBackend(backendHost, backendPort));

    // Website files accept GET/HEAD only. Unknown files are never replaced with the app HTML.
    app.use((request, response, next) => {
        if (!["GET", "HEAD"].includes(request.method)) {
            response.set("Allow", "GET, HEAD");
            return next(httpError(405, "Method not allowed."));
        }
        next();
    });
    app.get("/", (_request, response) => { response.sendFile(resolve(distDirectory, "index.html")); });
    app.use(express.static(distDirectory, { dotfiles: "deny", index: false, redirect: false }));
    app.use((_request, response) => { response.status(404).type("text/plain").send("Not found"); });
    app.use(errorHandler);
    return app;
}
