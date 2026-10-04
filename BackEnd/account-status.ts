import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { openDatabase, userByUsername } from "./database.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
try { loadEnvFile(resolve(root, ".env")); }
catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }

const [username, status] = process.argv.slice(2);

// Check that the username and status are valid. If not, print usage instructions and exit with an error code.
if (!username || !["active", "inactive"].includes(status)) {
    console.error("Usage: npm run account:status -- <username> <active|inactive>");
    process.exitCode = 1;
} else {
    // Open the database and update the user's account status. can change to different database if needed. The database is locked during this operation to prevent race conditions.
    const db = openDatabase(resolve(root, process.env.DATABASE_PATH ?? "BackEnd/data/game.sqlite"));
    try {
        const user = userByUsername(db, username);
        if (!user) throw new Error(`No account found for ${username}.`);
        db.exec("BEGIN IMMEDIATE");
        try {
            db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(status === "active" ? 1 : 0, user.id);
            if (status === "inactive") db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
            db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
        console.log(`${username} is now ${status}.`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    } finally { db.close(); }
}
