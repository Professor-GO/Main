# Faculty Arena

A hackathon prototype for a university professor collection and battle game. Players will recruit professors through token-based gacha draws and build teams to battle. Token generation, recruiting, and combat are future work. The professors shown on the login screen are fictional concept cards.

## Run locally

Use Node.js **24.x** (the backend uses its built-in SQLite support):

```sh
npm start
```

Open **http://127.0.0.1:3000**. No dependency installation or separate database service is needed for the current app. The frontend runs on port 3000 and proxies `/api/` requests to the backend on port 3001.

Create an account through the **Create account** tab; you will enter the player lobby immediately. Login, logout, password visibility, session restoration, and account status checks are implemented. Sessions last seven days and survive server restarts.

Optional: copy `.env.example` to `.env` to override hosts, ports, environment, or database path. Defaults work without an `.env` file. Node 24.7 may print an experimental SQLite warning; this is expected.

## Database

The backend creates **`BackEnd/data/game.sqlite`** on first startup. This file contains real local account data and is ignored by Git, along with its SQLite journal files.

| `users` column | Purpose |
| --- | --- |
| `id` | Unique internal account ID |
| `username` | Unique username, compared without regard to case |
| `password_hash` | Salted scrypt password hash; plaintext passwords are never stored |
| `created_at` | Account creation timestamp in UTC |
| `is_active` | `1` for active, `0` for inactive; new accounts default to active |

The `sessions` table stores hashed session tokens, account IDs, and expiry times. Only public account fields are returned by the API. Cookies use HttpOnly and SameSite=Lax, plus Secure when `APP_ENV=production` (serve the website over HTTPS in that mode).

Usernames must contain 3–20 letters, numbers, or underscores. Passwords must contain 8–128 characters. Database queries use bound parameters. Authentication requests have size limits, same-origin checks, and basic in-memory rate limits for the prototype.

To manage account status from your terminal:

```sh
npm run account:status -- PlayerName inactive
npm run account:status -- PlayerName active
```

Deactivating an account revokes its sessions. Inactive users cannot sign in; reactivated users can log in again. Status management is deliberately a local command, not a public API.

## API

Use the website origin for browser requests. Send JSON for POST requests.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Checks server and database availability |
| POST | `/api/auth/register` | Creates an active account and session; accepts `username`, `password` |
| POST | `/api/auth/login` | Authenticates an active account; accepts `username`, `password` |
| GET | `/api/auth/me` | Returns the authenticated user's public account fields |
| POST | `/api/auth/logout` | Revokes the current session; send `{}` |

Successful account responses contain `{ "user": { "id", "username", "createdAt", "isActive" } }`. Errors contain `{ "message": "..." }` and an appropriate HTTP status.

## Verify

```sh
npm test
```

Integration tests start isolated frontend/backend servers and create a temporary database. They cover registration, validation, case-insensitive and concurrent duplicate usernames, password checks, cookies, logout, inactive accounts, expiry, restart persistence, rate limiting, and private file protection. They do not use the development database.

The original course-template dependencies and build/lint scripts remain in `package.json`. They are not needed to run this plain JavaScript prototype; the old TypeScript build/lint tasks still target the template's absent `src`/`test` directories.

Implementation reference: [Node.js scrypt documentation](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).
