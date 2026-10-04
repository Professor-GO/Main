# Professor-Go

A hackathon prototype for a university-themed professor collection and battle game.
Players recruit professors through token-based gacha pulls, build their roster, and eventually expand the game into combat and map-based interactions.

This project is still in active prototype stage, with the core auth, database, gacha logic, and local game flow already in place.

## Overview

- Professors are fictional concept cards with unique stats and departments.
- Players create accounts and log in with Better Auth.
- The app includes local SQLite persistence, inventory management, and gacha pulls.
- The frontend is served as simple HTML/CSS/JS, while the backend runs TypeScript directly with Node.js.
- The app runs locally without any external database service.

## Quick start

Requirements:

- Node.js 24.x
- npm

Install dependencies:

```sh
npm install
```

Start the app:

```sh
npm start
```

Then open:

```text
http://127.0.0.1:3000
```

The app runs on:

- Frontend: `http://127.0.0.1:3000`
- Backend API: `http://127.0.0.1:3001`

The frontend proxies `/api/` requests to the backend.

## Project structure

```text
Main/
├── BackEnd/
│   ├── auth.ts
│   ├── database.ts
│   ├── server.ts
│   ├── schema.sql
│   ├── data/
│   ├── Express/
│   ├── Professor Gacha System/
│   └── Gemini.ts
├── BackEndTest/
├── FrontEnd/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── Assets/
├── package.json
├── tsconfig.json
├── README.md
└── .env.example (if present in your setup)
```

## Local development notes

- Node runs `.ts` files directly; there is no separate build step required to launch the app.
- Running `npm start` does not run TypeScript checking.
- Use `npm run typecheck` for strict type validation.
- `npm run build` performs the same type-checking logic without generating JavaScript files.

## Authentication and sessions

The app includes:

- account creation
- login/logout
- password visibility toggle
- session restoration
- account status checks
- inactive-user protection

Authentication is handled by [Better Auth](https://www.better-auth.com) in `BackEnd/auth.ts`.

Session details:

- sessions last 7 days
- sessions survive server restarts
- cookies use `HttpOnly` and `SameSite=Lax`
- `Secure` is enabled when `APP_ENV=production`

### Account rules

- usernames: 3–20 characters, letters/numbers/underscores
- passwords: 8–128 characters
- duplicate usernames are handled case-insensitively
- accounts are stored in SQLite via Better Auth tables

## Database

On first startup, the app creates the local database at:

```text
BackEnd/data/game.sqlite
```

This file contains local app data and is ignored by git, along with SQLite journal files.

The primary app schema is in [`BackEnd/schema.sql`](BackEnd/schema.sql), which the backend loads directly.

### Better Auth tables

| Table | Purpose |
| --- | --- |
| `user` | Player account row with username, display name, token balance, and active status |
| `account` | Salted password hash |
| `session` | Login session data and expiry |
| `verification` | Better Auth verification state |

Better Auth requires an email field for every account, but players only create a username and password. The app inserts a hidden placeholder email like:

```text
testplayer@players.professor-go.invalid
```

This placeholder is never shown and is not used for mail delivery.

### Game tables

The `inventory` table tracks each player's recruited professors, including:

- `user_id`
- `professor_id`
- `level`
- `copies`
- `obtained_at`

Each player has one row per professor. If they pull a professor they already own, the copy count increases instead of creating a duplicate row.

### Account status commands

```sh
npm run account:status -- PlayerName inactive
npm run account:status -- PlayerName active
```

Deactivating a player revokes all active sessions. Inactive users cannot log in until the account is reactivated.

## Professor gacha

The playable professor roster is defined in [`BackEnd/Professor Gacha System/Professor Pool/professors.ts`](BackEnd/Professor%20Gacha%20System/Professor%20Pool/professors.ts).

Each professor entry includes:

- `id`
- `name`
- `image`
- `avgRating` (1–5)
- `department`
- `stats` (`health`, `attack`, `defense`, `speed`)
- `copiesToLevelUp`

- **Rarity** comes from `avgRating`: Legendary from 4.5, Epic from 4.0, Rare from 3.0, otherwise Common.
- **Legendary professors** have a 0.08% chance per pull. After 50 pulls in a row without one, the chance rises in a straight line until pull 80, which is always Legendary. Pulling one resets the count.
- **Epic professors** have a 5% chance per pull. The 10th pull in a row without one is always Epic, unless it is Legendary.
- **Rare and Common professors** cannot be pulled.
- **Cages** fill every other pull: golden, iron, and bronze cages in a 1 : 5 : 10 ratio. Each player's cage counts are stored in the `items` table.
- Professors of the same rarity are equally likely. The pool is never used up, so a player can pull the same professor or cage any number of times.
- Each player's pity counts are stored in the `gacha_pity` table.
- Each pull costs `PULL_COST` (10) tokens. A new professor joins the player's inventory at level 1 with 1 copy; a professor the player already owns gains another copy. The token deduction, the prize, and the pity counts are saved in one transaction, so a failed pull never costs tokens.
- **Levelling up** is the player's choice: it spends the professor's `copiesToLevelUp` copies and raises their level by 1. The player always keeps the professor itself, so they need `copiesToLevelUp + 1` copies in total. For example, with `copiesToLevelUp: 2`, a player with 3 copies can level up and is left with 1.
- A professor's **level** and **copies** are stored in each player's inventory, not in the roster, because the roster is shared by every player. There is no maximum level yet.

The server refuses to start if the roster has no Legendary or no Epic professor, or an entry has a duplicate `id`, a rating outside 1–5, an unknown department, or a stat or `copiesToLevelUp` that is not a positive whole number. Do not change a professor's `id` after players have recruited them; it is what the `inventory` table stores.

### Important rules

- a duplicate `id` is rejected
- rating must be within 1–5
- department must be valid
- stat values and `copiesToLevelUp` must be positive whole numbers
- do not rename a professor `id` after players have recruited them

## API overview

Use the website origin for browser requests, and send JSON for POST requests.

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/health` | Checks server and database availability |
| POST | `/api/auth/register` | Creates an active account and session; accepts `username`, `password` |
| POST | `/api/auth/login` | Authenticates an active account; accepts `username`, `password` |
| GET | `/api/auth/me` | Returns the authenticated user's public account fields |
| POST | `/api/auth/logout` | Revokes the current session; send `{}` |
| GET | `/api/gacha/pool` | Returns `{ "cost", "professors", "cages" }`: the pull cost, and every professor and cage with its `pullChance` before pity |
| POST | `/api/gacha/pull` | Logged-in players only; send `{}`. Spends tokens and returns `{ "kind": "professor", "item", "isNew", "pity", "user" }` or `{ "kind": "cage", "cage", "quantity", "pity", "user" }`, or `409` if the player has too few tokens. `isNew` is `false` when the pull added a copy of a professor the player already owned |
| GET | `/api/inventory` | Logged-in players only. Returns `{ "inventory", "cages" }`: the player's professors, oldest first, and their cages |
| POST | `/api/inventory/level-up` | Logged-in players only; send `{ "professorId" }`. Spends copies and returns `{ "item" }`; `404` if the player does not own that professor, `409` if they need more copies |

- `question`
- `topic`
- `difficulty`
- `choices`
- `answerIndex`
- `explanation`
- `source`

It uses Gemini when `GEMINI_API_KEY` is configured; otherwise it falls back to a local built-in question.

## Environment variables

Optional local settings can go in a `.env` file at the project root.

Useful values include:

```sh
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://127.0.0.1:3000
APP_ENV=development
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.8-flash
```

Notes:

- `BETTER_AUTH_SECRET` signs session cookies
- changing it logs everyone out
- without it, the app uses a built-in development secret
- `APP_ENV=production` disables some development behavior and requires HTTPS
- `GEMINI_API_KEY` enables Gemini-powered coding questions

## Verification

Run:

```sh
npm install
npm run typecheck
npm test
```

The tests cover:

- registration and validation
- duplicate username handling
- password checks
- cookies and logout
- inactive accounts and session expiry
- database persistence across restarts
- rate limiting
- private file protection
- gacha odds and token deduction

## Main backend files

- `BackEnd/server.ts` — starts the app and serves the frontend
- `BackEnd/auth.ts` — Better Auth setup
- `BackEnd/database.ts` — SQLite connection and helpers
- `BackEnd/account-status.ts` — account status actions
- `BackEnd/Gemini.ts` — AI question generation
- `BackEnd/schema.sql` — base SQL schema
- `BackEnd/Professor Gacha System/` — roster and gacha logic
- `BackEndTest/*.test.ts` — automated tests

## References

- [Node.js TypeScript support](https://nodejs.org/docs/latest/v24.x/api/typescript.html)
- [Better Auth docs](https://www.better-auth.com/docs)
- [Better Auth username plugin](https://www.better-auth.com/docs/plugins/username)
