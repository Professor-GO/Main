import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";

const projectRoot = fileURLToPath(new URL("./", import.meta.url));
const frontendRoot = resolve(projectRoot, "FrontEnd");

/** Loads the same host/port settings as the API without exposing server secrets to the browser. */
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, projectRoot, "");
    const frontendHost = env.FRONTEND_HOST || "127.0.0.1";
    const frontendPort = Number(env.FRONTEND_PORT || 3000);
    const backendHost = env.BACKEND_HOST || "127.0.0.1";
    const connectHost = backendHost === "0.0.0.0" ? "127.0.0.1" : backendHost === "::" ? "::1" : backendHost;
    const proxy = {
        "/api": {
            target: `http://${connectHost.includes(":") ? `[${connectHost}]` : connectHost}:${env.BACKEND_PORT || 3001}`,
            // Preserve the website's Host header for origin checks and session cookies.
            changeOrigin: false,
            timeout: 30_000,
            proxyTimeout: 30_000,
        },
    };
    return {
        root: frontendRoot,
        envDir: projectRoot,
        appType: "mpa",
        build: { outDir: resolve(projectRoot, "dist"), emptyOutDir: true },
        server: {
            host: frontendHost,
            port: frontendPort,
            strictPort: true,
            proxy,
            fs: { strict: true, allow: [frontendRoot] },
        },
        preview: { host: frontendHost, port: frontendPort, strictPort: true, proxy },
    };
});
