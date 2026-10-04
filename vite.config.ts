/** Vite serves only client sources; the existing website API edge preserves security semantics. */
import { defineConfig } from "vite";
import type { Connect } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "./src/server/bootstrap/config.ts";
import { createFrontendApp } from "./src/server/http/websiteApp.ts";

const root = fileURLToPath(new URL(".", import.meta.url));
const clientRoot = fileURLToPath(new URL("./src/client", import.meta.url));
export default defineConfig(() => {
  const config = readConfig(root, process.env);
  return {
    root: "src/client",
    plugins: [
      react(),
      {
        name: "professor-go-api-edge",
        configureServer(server) {
          // Express initializes its request/response extensions before handling Connect requests.
          const edge = createFrontendApp({
            assets: new Map(),
            backendHost: config.backendConnectHost,
            backendPort: config.backendPort,
          }) as unknown as Connect.NextHandleFunction;
          server.middlewares.use((request, response, next) => {
            const path = request.url?.split("?")[0] ?? "";
            // The client has its own src/client/api/ folder, served at /api/ too; Vite serves
            // those source modules, and only real API paths go to the API edge.
            const clientModule =
              /\.(tsx?|css)$/.test(path) && existsSync(join(clientRoot, path));
            if ((path === "/api" || path.startsWith("/api/")) && !clientModule)
              edge(request, response, next);
            else next();
          });
        },
      },
    ],
    build: { outDir: "../../dist/client", emptyOutDir: true },
    server: {
      host: config.frontendHost,
      port: config.frontendPort,
      strictPort: true,
      fs: {
        strict: true,
        allow: [
          fileURLToPath(new URL("./src/client", import.meta.url)),
          fileURLToPath(new URL("./node_modules", import.meta.url)),
          // Artwork the campus map and the recruit page import (src/client/features/world/art.ts
          // and src/client/features/recruitment/art.ts). The rest of Assets/ stays private.
          fileURLToPath(new URL("./Assets/outdoor", import.meta.url)),
          fileURLToPath(new URL("./Assets/characters", import.meta.url)),
          // The rooms, the gashapon machine, the battle clearing, and the stickman heads.
          fileURLToPath(new URL("./Assets/textures", import.meta.url)),
          fileURLToPath(new URL("./Assets/furniture", import.meta.url)),
          fileURLToPath(new URL("./Assets/classroom", import.meta.url)),
          fileURLToPath(new URL("./Assets/gacha", import.meta.url)),
          fileURLToPath(new URL("./Assets/fighting_scene", import.meta.url)),
          fileURLToPath(new URL("./Assets/stickman", import.meta.url)),
          fileURLToPath(new URL("./Assets/gacha", import.meta.url)),
          fileURLToPath(new URL("./Assets/battle/heads", import.meta.url)),
        ],
      },
    },
  };
});
