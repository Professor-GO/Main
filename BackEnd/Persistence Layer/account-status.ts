import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { DEFAULT_DATABASE_PATH, openDatabase } from "./database.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
try { loadEnvFile(resolve(root, ".env")); }
catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }

const [username, status] = process.argv.slice(2);

// Check that the username and status are valid. If not, print usage instructions and exit with an error code.
if (!username || !["active", "inactive"].includes(status)) {
    console.error("Usage: npm run account:status -- <username> <active|inactive>");
    process.exitCode = 1;
} else {
    // Open the database and update the user's account status. can change to different database if needed. The database is locked during this operation to prevent race conditions.
    const db = openDatabase(resolve(root, process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH));
    try {
        if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user'").get()) {
            throw new Error("No accounts yet: start the game once with `npm start` to create the account tables.");
        }
        // Better Auth stores usernames in lowercase (see auth.ts in this folder).
        const user = db.prepare('SELECT id FROM "user" WHERE username = ?').get(username.toLowerCase()) as { id: string } | undefined;
        if (!user) throw new Error(`No account found for ${username}.`);
        db.exec("BEGIN IMMEDIATE");
        try {
            db.prepare('UPDATE "user" SET isActive = ? WHERE id = ?').run(status === "active" ? 1 : 0, user.id);
            // Deactivating also logs the player out everywhere.
            if (status === "inactive") db.prepare("DELETE FROM session WHERE userId = ?").run(user.id);
            db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
        console.log(`${username} is now ${status}.`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    } finally { db.close(); }
}
