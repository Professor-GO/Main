import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { loadAssets } from "../assets.ts";
import { createFrontendApp } from "../../http/websiteApp.ts";

test("built client serves only public build assets with existing headers and methods", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "professor-assets-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "assets"));
    for (const [name, text] of Object.entries({ "index.html": "<title>Professor-Go</title>", "favicon.svg": "<svg/>", "assets/index-123.js": "console.log('client')", "assets/index-123.css": "body{}", "assets/private.ts": "secret", "assets/index.js.map": "secret", ".env": "secret", "package.json": "secret" })) {
        await writeFile(join(root, name), text);
    }
    const app = createFrontendApp({ assets: await loadAssets(root), backendHost: "127.0.0.1", backendPort: 1 });
    const server = createServer(app).listen(0, "127.0.0.1");
    t.after(() => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }));
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    for (const path of ["/", "/index.html", "/favicon.svg", "/assets/index-123.js", "/assets/index-123.css"]) {
        const response = await fetch(origin + path);
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.match(response.headers.get("content-security-policy") ?? "", /script-src 'self'/);
    }
    assert.match((await fetch(origin + "/assets/index-123.js")).headers.get("content-type") ?? "", /javascript/);
    assert.equal(await (await fetch(origin, { method: "HEAD" })).text(), "");
    const post = await fetch(origin, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
    for (const path of ["/.env", "/package.json", "/src/client/main.tsx", "/.agent-teams/team.json", "/BackEnd/Persistence%20Layer/data/game.sqlite", "/assets/private.ts", "/assets/index.js.map", "/assets/%2e%2e%2f.env", "/assets/..%5c.env", "/unknown", "/FrontEnd/app.js"]) {
        assert.equal((await fetch(origin + path)).status, 404, path);
    }
});

test("missing build fails explicitly rather than serving legacy source", async () => {
    await assert.rejects(loadAssets(join(tmpdir(), "professor-nonexistent-client-build")), /ENOENT/);
});
