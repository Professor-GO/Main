/** Runs Vite and the API together; an IPC lease prevents an orphan API on parent exit. */
import { fork } from "node:child_process";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
let api;
let vite;
let stopping = false;

/** Closes the browser listener and terminates the owned API, never unrelated processes. */
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  await vite?.close();
  if (api && api.exitCode === null) api.kill("SIGTERM");
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
try {
  try {
    loadEnvFile(resolve(root, ".env"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (process.env.APP_ENV === "production")
    throw new Error(
      "npm run dev is for development; use npm run build and npm start for production.",
    );
  api = fork(resolve(root, "src/server/bootstrap/server.ts"), ["--api-only"], {
    cwd: root,
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  api.once("error", (error) => {
    console.error(error);
    void stop(1);
  });
  api.once("exit", (code) => {
    if (!stopping) void stop(code || 1);
  });
  vite = await createServer({ configFile: resolve(root, "vite.config.ts") });
  if (stopping) await vite.close();
  else {
    await vite.listen();
    vite.printUrls();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await stop(1);
}
