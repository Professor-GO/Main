/** Loads only public build output; never expose the repository as a static directory. */
import { readFile, readdir, lstat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Asset } from "../http/websiteApp.ts";

const CONTENT_TYPES: Record<string, string> = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};

/** Reads a Vite build into the existing exact-path allowlist. Missing builds fail startup. */
export async function loadAssets(directory: string): Promise<Map<string, Asset>> {
    const assets = new Map<string, Asset>();
    const index = join(directory, "index.html");
    if (!(await lstat(index)).isFile()) throw new Error("Client index.html must be a regular file.");
    const page = { contentType: "text/html; charset=utf-8", body: await readFile(index) };
    assets.set("/", page);
    assets.set("/index.html", page);
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.name === "favicon.svg" && entry.isFile())) {
        assets.set("/favicon.svg", { contentType: "image/svg+xml", body: await readFile(join(directory, "favicon.svg")) });
    }
    if (entries.some((entry) => entry.name === "assets" && entry.isDirectory())) {
        for (const entry of await readdir(join(directory, "assets"), { withFileTypes: true })) {
            const contentType = CONTENT_TYPES[extname(entry.name)];
            if (!entry.isFile() || !/^[\w-]+\.[\w]+$/.test(entry.name) || !contentType) continue;
            assets.set(`/assets/${entry.name}`, { contentType, body: await readFile(join(directory, "assets", entry.name)) });
        }
    }
    return assets;
}
