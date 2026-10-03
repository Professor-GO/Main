# Professor-Go

A hackathon prototype for a university professor collection and battle game. Players will recruit professors through token-based gacha draws and build teams to battle. Token generation, recruiting, and combat are future work. The professors shown on the login screen are fictional concept cards.

## Run locally

Use Node.js **24.x**. The backend is written in TypeScript and uses Node's built-in TypeScript execution and SQLite support:

```sh
npm start
```

Open **http://127.0.0.1:3000**. No dependency installation or separate database service is needed for the current app. The frontend runs on port 3000 and proxies `/api/` requests to the backend on port 3001.

Node runs the `.ts` files directly; there is no compilation step before starting the app. Running the app does not check types. Install the development dependencies with `npm install` and use `npm run typecheck` to check the backend and tests with strict TypeScript settings. `npm run build` runs the same check without generating JavaScript files. The frontend remains HTML, CSS, and browser JavaScript.

Create an account through the **Create account** tab; you will enter the player lobby immediately. Login, logout, password visibility, session restoration, and account status checks are implemented. Sessions last seven days and survive server restarts.

Optional: create a local `.env` file in the project root to override hosts, ports, environment, or database path. Defaults work without an `.env` file. Node 24.7 may print an experimental SQLite warning; this is expected.

## Database

The backend creates **`BackEnd/data/game.sqlite`** on first startup. This file contains real local account data and is ignored by Git, along with its SQLite journal files.

The reusable SQLite schema template is **[`BackEnd/schema.sql`](BackEnd/schema.sql)**. It defines the account and session tables, their defaults, constraints, and relationship. The backend loads this file directly, so the template and app use the same schema. It contains no account data and can be committed to Git.

Run `npm start` to initialize the database automatically, or run the SQL file against a SQLite database using your preferred database tool. Running it again preserves existing rows. Editing a `CREATE TABLE IF NOT EXISTS` definition does not modify an existing table; changes to existing columns need a separate migration. Columns added later, such as `tokens`, are added to older databases automatically by `BackEnd/database.ts` on startup.

| `users` column | Purpose |
| --- | --- |
| `id` | Unique internal account ID |
| `username` | Unique username, compared without regard to case |
| `password_hash` | Salted scrypt password hash; plaintext passwords are never stored |
| `created_at` | Account creation timestamp in UTC |
| `is_active` | `1` for active, `0` for inactive; new accounts default to active |
| `tokens` | Gacha token balance; new accounts start at `0`, and it can never be negative |

The `sessions` table stores hashed session tokens, account IDs, and expiry times. The `user_professors` table stores one row per recruited professor (`user_id`, `professor_id`, `pulled_at`); pulling the same professor twice adds two rows. Only public account fields are returned by the API. Cookies use HttpOnly and SameSite=Lax, plus Secure when `APP_ENV=production` (serve the website over HTTPS in that mode).

Usernames must contain 3–20 letters, numbers, or underscores. Passwords must contain 8–128 characters. Database queries use bound parameters. Authentication requests have size limits, same-origin checks, and basic in-memory rate limits for the prototype.

To manage account status from your terminal:

```sh
npm run account:status -- PlayerName inactive
npm run account:status -- PlayerName active
```

Deactivating an account revokes its sessions. Inactive users cannot sign in; reactivated users can log in again. Status management is deliberately a local command, not a public API.

## Professor gacha

The recruitable professors are listed in [`BackEnd/Professor Gacha System/Professor Pool/professors.ts`](BackEnd/Professor%20Gacha%20System/Professor%20Pool/professors.ts). Each entry has an `id`, `name`, `image` path, `avgRating` (1–5), `department` (the professor's element), and `stats` (`health`, `attack`, `defense`, `speed`). The current entries are fictional placeholders, and their image files have not been added yet.

[`BackEnd/Professor Gacha System/gacha.ts`](BackEnd/Professor%20Gacha%20System/gacha.ts) calculates the rest, so they never need to be entered by hand:

- **Pull chance** is proportional to `1 / avgRating`, so better-rated professors are harder to pull. Chances across the pool add up to 1.
- **Rarity** comes from `avgRating`: Legendary from 4.5, Epic from 4.0, Rare from 3.0, otherwise Common.
- Each pull costs `PULL_COST` (10) tokens. The token deduction and the recruited professor are saved in one transaction, so a failed pull never costs tokens.

The server refuses to start if a roster entry has a duplicate `id`, a rating outside 1–5, an unknown department, or a stat that is not a positive whole number. Do not change a professor's `id` after players have recruited them; it is what `user_professors` stores.

## API

Use the website origin for browser requests. Send JSON for POST requests.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Checks server and database availability |
| POST | `/api/auth/register` | Creates an active account and session; accepts `username`, `password` |
| POST | `/api/auth/login` | Authenticates an active account; accepts `username`, `password` |
| GET | `/api/auth/me` | Returns the authenticated user's public account fields |
| POST | `/api/auth/logout` | Revokes the current session; send `{}` |
| GET | `/api/gacha/pool` | Returns `{ "cost", "professors" }`: the pull cost and every professor with `rarity` and `pullChance` |
| POST | `/api/gacha/pull` | Logged-in players only; send `{}`. Spends tokens and returns `{ "professor", "user" }`, or `409` if the player has too few tokens |

Successful account responses contain `{ "user": { "id", "username", "createdAt", "isActive", "tokens" } }`. Errors contain `{ "message": "..." }` and an appropriate HTTP status.

## Verify

```sh
npm install
npm run typecheck
npm test
```

Integration tests start isolated frontend/backend servers and create a temporary database. They cover registration, validation, case-insensitive and concurrent duplicate usernames, password checks, cookies, logout, inactive accounts, expiry, restart persistence, rate limiting, private file protection, gacha odds, and token spending on pulls. They do not use the development database.

The backend files are `BackEnd/server.ts`, `BackEnd/database.ts`, `BackEnd/account-status.ts`, the gacha files under `BackEnd/Professor Gacha System/`, and the tests `BackEnd/auth.test.ts` and `BackEnd/gacha.test.ts`. Local imports include the `.ts` extension, and `tsconfig.json` checks every TypeScript file under `BackEnd/`. Use erasable TypeScript syntax (types, interfaces, and annotations); enums and constructor parameter properties require a separate transpiler and are rejected by this configuration.

The original course-template dependencies and lint/format/coverage scripts remain in `package.json`. The legacy `build:lint`, lint, and format tasks still refer to absent `src`/`test` directories; use `npm run typecheck` and `npm test` for the current app.

Implementation references: [Node.js TypeScript support](https://nodejs.org/docs/latest-v24.x/api/typescript.html) and [Node.js scrypt documentation](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).
