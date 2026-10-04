# Game Engine

A university-themed game prototype with account access, a player lobby, and coding questions that award tokens. Recruitment, inventory, and level-up APIs exist; the browser recruitment and battle buttons remain placeholders.

## Run locally

Use **Node.js 24.x** and npm. The backend runs TypeScript directly with Node type stripping and built-in SQLite. The React/TypeScript client is built by Vite.

```sh
npm install --ignore-scripts
npm run dev
```

Open `http://127.0.0.1:3000`. The native development launcher runs Vite on the website port and Express on API port 3001. It loads repository-root `.env`, preserves the website Host and cookies through the API proxy, and closes its API child when the launcher stops. Ctrl+C stops the development application. `--ignore-scripts` disables dependency lifecycle scripts; the obsolete repository postinstall hook has been removed.

To run the built application without Vite:

```sh
npm run build
npm start
```

`npm start` requires `dist/client` from the build. It starts both Express listeners in one process. Restart after rebuilding assets because production assets are loaded into memory at startup. Starting does not type-check. For deployment, set `APP_ENV=production`, a real `BETTER_AUTH_SECRET`, and an HTTPS `BETTER_AUTH_URL`; serve HTTPS through the deployment edge. This repository work does not deploy the app.

## Configuration and data

Server and development launcher read `.env` from the repository root; existing process variables take precedence. Configuration names:

- `APP_ENV`: development, test, or production.
- `FRONTEND_HOST`, `FRONTEND_PORT`: default `127.0.0.1`, `3000`.
- `BACKEND_HOST`, `BACKEND_PORT`: default `127.0.0.1`, `3001`.
- `DATABASE_PATH`: optional absolute path or repository-root-relative path.
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`: session signing and public website URL. Production requires a real secret; Secure cookies require HTTPS.
- `GEMINI_API_KEY`, `GEMINI_MODEL`: optional question generation settings. Empty API key uses a local fallback.

The database default remains **`BackEnd/Persistence Layer/data/game.sqlite`**. Source relocation does not migrate or replace it. Both legacy data directories can contain real account data; never use them as test fixtures. Tests create disposable databases. Better Auth owns accounts, passwords, and sessions. Legacy `users`/`sessions` are preserved, and an old inventory referencing `users` is preserved as `inventory_legacy`, not migrated into new accounts.

Local account administration modifies the configured database:

```sh
npm run account:status -- PlayerName inactive
npm run account:status -- PlayerName active
```

Deactivation revokes sessions; reactivation requires fresh login.

## Maintained structure

```text
src/client/             React pages, typed API clients, question state, local CSS
src/server/bootstrap/   Startup, validated configuration, built-asset loading
src/server/http/        Express API composition, website proxy and security headers
src/server/modules/     Accounts, recruitment and questions (current implementation)
src/server/storage/     SQLite initialization and schema
scripts/dev.mjs         Native Vite/API development lifecycle
scripts/tests/          Disposable-database development proxy/cleanup checks
dist/client/            Generated deployable client assets
Assets/                 Private artwork, not automatically published
```

This milestone delivers the runnable client/server framework and preserves existing behavior. The deeper domain/use-case/adapter extraction from the original full refactor plan is **deferred**. Independent framework and browser parity review passed before removing the obsolete `FrontEnd/` implementation; its historical version remains in Git. This does not imply that the deeper architecture work is complete. Work remains on `chore/integration`; no merge, push, or deployment is implied.

### Legacy cleanup

The old `FrontEnd/`, `BackEnd/` and `BackEndTest/` source trees are no longer maintained or required to build the application. Backend code and tests live under `src/server/`; obsolete frontend code was removed after parity verification. Historical implementations remain available in Git. Empty legacy directories have also been removed from the working copy.

The `BackEnd/` name remains only in the backward-compatible default database location and security regression probes. Starting with the default database configuration may recreate its data directory; that is persistent storage, not a second backend implementation. Do not delete existing databases, legacy-table preservation logic, or private-path tests as obsolete code. Unused legacy dependencies, the old coverage command and the postinstall Git hook mutation have been removed; the maintained runners are Node's test runner and Vitest.

## Verification

```sh
npm run typecheck
npm test
npm run lint:check
npm run build
```

- Typecheck runs `tsconfig.server.json` (NodeNext) and `tsconfig.client.json` (browser/bundler) separately.
- `test:server` uses Node's runner for `src/server/**/*.test.ts`, with file concurrency limited to one to avoid competing server startups exhausting fixed readiness deadlines. Assertions and timeout thresholds are unchanged, including the concurrent-signup test. Run one suite directly with Node or use `test:auth`.
- `test:client` first runs existing pure-state `.test.ts` tests with Node, then Vitest discovers only `.test.tsx` and `.vitest.ts` files. These discovery patterns do not overlap.
- `test:tooling` starts the real dev launcher against temporary SQLite, checks cookie/origin/rate-limit/private-file behavior, stops it, and verifies both ports close.
- `npm test` runs all three groups. Server HTTP tests build their own disposable client assets where required.
- ESLint covers maintained client/server/config/tooling sources, including a client-to-server import restriction. Prettier is separate and targets maintained sources.

The previously observed intermittent authentication child-startup timeout is recorded in the vault milestone evidence. Do not conceal recurrence by increasing a threshold without diagnosis. Unused legacy dependencies and test tooling have been removed. Recheck dependency advisories with `npm audit`; a clean audit is point-in-time evidence, not a security guarantee.

## Contracts and security

Browser API requests are same-origin. POST bodies are JSON objects; errors use `{ message }`. API edges retain origin checks, bounded JSON, rate limits, cookies and response security headers. Vite reuses the existing Express API edge so its stricter login/register limiter is not bypassed. Production serves only the built-asset allowlist, never the repository root, source, environment, team files, or database. The client imports no server internals and exposes no server environment variables.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/health` | API/database health |
| POST | `/api/auth/register` | Create account and session |
| POST | `/api/auth/login` | Authenticate |
| GET | `/api/auth/me` | Public profile with string ID and token balance |
| POST | `/api/auth/logout` | Revoke session |
| GET | `/api/gacha/pool` | Roster and pull cost |
| POST | `/api/gacha/pull` | Spend tokens, award professor or cage, and update pity atomically |
| GET | `/api/inventory` | Owned professors and cages |
| POST | `/api/inventory/level-up` | Spend spare copies |
| GET | `/api/question` | Player-owned question attempt, no answer or explanation |
| POST | `/api/question/answer` | Submit `{ questionId, selectedIndex }` |

Accounts begin with 50 tokens; a pull costs 10. Professor IDs remain stable inventory keys, and duplicates add copies. Level-up retains at least one copy.

### Recruitment rules merged from main

The roster lives in `src/server/modules/recruitment/domain/professors.ts`; policy lives in `src/server/modules/recruitment/application/recruitment.ts`.

- Legendary professors share a 0.08% base chance. After 50 pulls without one, the chance rises linearly to a guarantee on pull 80.
- Epic professors share a 5% base chance. The 10th pull without an Epic guarantees an Epic unless it is Legendary; Legendary takes precedence when both guarantees are due.
- Professors within each eligible tier are equally likely. Rare and Common roster entries cannot be pulled. The roster must contain a Legendary and an Epic; IDs, departments, ratings, stats and copy costs remain validated.
- Other pulls award golden, iron or bronze cages in a 1:5:10 ratio. Cage counts live in `items`; player counters live in `gacha_pity`. Token debit, prize and counters are saved atomically. Tables are created if missing; existing accounts and inventory are retained.

Pool responses include `{ cost, professors, cages }`. Pull responses are `{ kind: "professor", item, isNew, pity, user }` or `{ kind: "cage", cage, quantity, pity, user }`. Inventory returns `{ inventory, cages }`. Recruitment and battle UI remain placeholders. New `Assets/gacha/` artwork is retained privately, not exposed by the public build allowlist.

Question correctness and rewards remain server-owned. A correct first answer awards one token atomically with the recorded choice. Same-choice retries are idempotent; changed answers are rejected. A lost response enables only explicit same-choice retry in the UI, not automatic resubmission. React renders generated/player content as text.
