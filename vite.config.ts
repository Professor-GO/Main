import { cpSync, createReadStream, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";

const projectRoot = fileURLToPath(new URL("./", import.meta.url));
const frontendRoot = resolve(projectRoot, "FrontEnd");
const distRoot = resolve(projectRoot, "dist");

// The Assets/ folders the website shows, such as /Assets/gacha/capsule_red.png. Other
// folders in Assets/ (maps, furniture) are not published until a page uses them.
const PUBLIC_ASSET_FOLDERS = ["gacha", "characters"];

/**
 * Publishes the game pictures from Assets/, which is outside the website folder, at /Assets/.
 * The dev server serves them straight from Assets/, and the build copies them into dist/Assets/,
 * where the production frontend server finds them.
 * @returns The Vite plugin.
 */
function gameAssets(): Plugin {
    return {
        name: "professor-go-assets",
        configureServer(server) {
            for (const folder of PUBLIC_ASSET_FOLDERS) {
                const folderRoot = resolve(projectRoot, "Assets", folder);
                // Sends a PNG from the folder; anything else (other files, "..") falls through to a 404.
                server.middlewares.use(`/Assets/${folder}`, (request, response, next) => {
                    let file: string;
                    try {
                        file = resolve(folderRoot, `.${decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname)}`);
                    } catch {
                        return next();
                    }
                    if (!file.startsWith(folderRoot + sep) || !file.endsWith(".png") || !statSync(file, { throwIfNoEntry: false })?.isFile()) return next();
                    response.setHeader("Content-Type", "image/png");
                    createReadStream(file).pipe(response);
                });
            }
        },
        writeBundle() {
            for (const folder of PUBLIC_ASSET_FOLDERS) {
                cpSync(resolve(projectRoot, "Assets", folder), resolve(distRoot, "Assets", folder), { recursive: true });
            }
        },
    };
}

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
        plugins: [gameAssets()],
        // Vite's own files go in dist/bundle/, so they never mix with dist/Assets/ (the two
        // names would be the same folder on Windows, which ignores letter case).
        build: { outDir: distRoot, emptyOutDir: true, assetsDir: "bundle" },
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
