// Player accounts, powered by Better Auth (https://www.better-auth.com).
//
// Better Auth stores accounts in its own tables in game.sqlite: "user" (one row per
// player, including their tokens), "session" (logins), "account" (password hashes),
// and "verification". createAuth() creates or upgrades these tables on startup.
//
// Players sign up and log in with a username and password. Better Auth requires an
// email for every account, so each player gets a hidden placeholder email made from
// their username (see hiddenEmail()). It is never shown or used to send mail.

import type { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { username } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";

// Tokens every new account starts with.
export const STARTING_TOKENS = 110;
// How long a login lasts without being used: 7 days.
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
// Usernames are 3–20 letters, numbers, or underscores.
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;
// Used when BETTER_AUTH_SECRET is not set, outside production only. Anyone can read this
// value, so production refuses to start without a real secret.
export const DEVELOPMENT_SECRET = "professor-go-development-secret-not-for-production";

// The domain of every hidden placeholder email. ".invalid" is reserved, so it can never receive mail.
const HIDDEN_EMAIL_DOMAIN = "players.professor-go.invalid";

/** What createAuth() needs from server.ts. */
export type AuthSettings = {
    // The website's address, such as "http://127.0.0.1:3000".
    baseURL: string;
    // Signs session cookies. Use a long random value (BETTER_AUTH_SECRET in .env).
    secret: string;
    // True in production, where session cookies are marked Secure (HTTPS only).
    production: boolean;
};

/** A player's account as sent to the website, without any private fields. */
export type PublicUser = {
    id: string;
    username: string;
    createdAt: string;
    isActive: boolean;
    tokens: number;
};

/**
 * Makes the hidden placeholder email Better Auth stores for a player.
 * @param name - The player's username. Letter case is ignored.
 * @returns An email such as "testplayer@players.professor-go.invalid".
 */
export function hiddenEmail(name: string): string {
    return `${name.toLowerCase()}@${HIDDEN_EMAIL_DOMAIN}`;
}

/**
 * Builds the Better Auth configuration.
 * @param db - The open game database. Better Auth stores its tables in it.
 * @param settings - The website's address, the cookie secret, and whether this is production.
 * @returns The options to pass to betterAuth().
 */
function authOptions(db: DatabaseSync, { baseURL, secret, production }: AuthSettings) {
    return {
        database: db,
        baseURL,
        secret,
        emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
        plugins: [
            // Log in with a username. Usernames are stored lowercase, so "TestPlayer" and
            // "testplayer" are the same player; the original casing is kept as displayUsername.
            username({ minUsernameLength: 3, maxUsernameLength: 20, usernameValidator: (name) => USERNAME_PATTERN.test(name) }),
        ],
        user: {
            additionalFields: {
                // Gacha token balance. Only the server changes it (input: false).
                tokens: { type: "number", required: false, defaultValue: STARTING_TOKENS, input: false },
                // Inactive accounts cannot log in. Changed with `npm run account:status`.
                isActive: { type: "boolean", required: false, defaultValue: true, input: false },
            },
        },
        session: { expiresIn: SESSION_SECONDS },
        databaseHooks: {
            session: {
                create: {
                    // Stops inactive accounts from logging in, even with the right password.
                    before: async (session) => {
                        const user = db.prepare('SELECT isActive FROM "user" WHERE id = ?').get(session.userId) as { isActive: number } | undefined;
                        if (!user?.isActive) throw new APIError("FORBIDDEN", { message: "This account is inactive. Contact the game organizers." });
                    },
                },
            },
        },
        advanced: { cookiePrefix: "professor-go", useSecureCookies: production },
        // Failed log-ins are normal; only log real errors.
        logger: { level: "error" },
    } satisfies BetterAuthOptions;
}

/**
 * Sets up Better Auth: creates or upgrades its tables, then adds a rule Better Auth does
 * not enforce itself: token balances can never go negative. (Its tables already make
 * usernames and emails unique.)
 * @param db - The open game database (from openDatabase()).
 * @param settings - The website's address, the cookie secret, and whether this is production.
 * @returns A promise for the Better Auth instance. Its `api` has the account functions,
 * such as auth.api.signInUsername().
 */
export async function createAuth(db: DatabaseSync, settings: AuthSettings) {
    const options = authOptions(db, settings);
    const { runMigrations } = await getMigrations({ ...options, logger: { disabled: true } });
    await runMigrations();
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS user_tokens_not_negative_insert BEFORE INSERT ON "user"
            WHEN NEW.tokens < 0 BEGIN SELECT RAISE(ABORT, 'tokens cannot be negative'); END;
        CREATE TRIGGER IF NOT EXISTS user_tokens_not_negative_update BEFORE UPDATE OF tokens ON "user"
            WHEN NEW.tokens < 0 BEGIN SELECT RAISE(ABORT, 'tokens cannot be negative'); END;
    `);
    return betterAuth(options);
}

/** The Better Auth instance returned by createAuth(). */
export type Auth = Awaited<ReturnType<typeof createAuth>>;

/** The logged-in player's account, as Better Auth returns it. */
export type AuthUser = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>["user"];

// The account fields publicUser() reads. Better Auth's types for some functions, such as
// signInUsername, leave out tokens and isActive even though they are returned, so those are optional here.
type AccountFields = Pick<AuthUser, "id" | "name" | "createdAt"> & Partial<Pick<AuthUser, "username" | "displayUsername" | "tokens" | "isActive">>;

/**
 * Converts a Better Auth account into the shape sent to the website.
 * @param user - The account from Better Auth.
 * @returns The account's id, username (with its original casing), createdAt, isActive, and tokens.
 */
export function publicUser(user: AccountFields): PublicUser {
    return {
        id: user.id,
        username: user.displayUsername ?? user.username ?? user.name,
        createdAt: new Date(user.createdAt).toISOString(),
        isActive: user.isActive !== false,
        tokens: user.tokens ?? 0,
    };
}
