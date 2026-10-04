/** Vite serves only client sources; the existing website API edge preserves security semantics. */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { readConfig } from "./src/server/bootstrap/config.ts";
import { createFrontendApp } from "./src/server/http/websiteApp.ts";

const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig(() => {
  const config = readConfig(root, process.env);
  return {
    root: "src/client",
    plugins: [
      react(),
      {
        name: "professor-go-api-edge",
        configureServer(server) {
          const edge = createFrontendApp({
            assets: new Map(),
            backendHost: config.backendConnectHost,
            backendPort: config.backendPort,
          });
          server.middlewares.use((request, response, next) => {
            const path = request.url?.split("?")[0] ?? "";
            if (path === "/api" || path.startsWith("/api/"))
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
        ],
      },
    },
  };
});
