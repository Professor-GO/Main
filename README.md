# Game Engine

A university-themed game prototype with account access, a player lobby, coding questions that award tokens, and wild professor battles on the campus map. Players recruit professors from a gashapon machine on the recruit page; the team button remains a placeholder.

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

The old `FrontEnd/` and `BackEnd/` source trees are no longer maintained or required to build the application. Backend code and tests live under `src/server/`; obsolete frontend code was removed after parity verification. `BackEndTest/auth.test.ts` is a compatibility entry point for the maintained authentication suite, so `node --test BackEndTest/auth.test.ts` still works. Historical implementations remain available in Git.

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
| POST | `/api/gacha/pull` | Spend tokens, award professor or cage, and update pity atomically. With `{ count: 10 }`, makes ten pulls if the player can afford all ten and replies `{ pulls, user }` |
| GET | `/api/inventory` | Owned professors and cages |
| GET | `/api/gacha/pool` | Roster with each professor's cage and base chance, the cages, and pull cost |
| GET | `/api/gacha/pity` | The player's pity, pull cost, and guarantee size |
| POST | `/api/gacha/pull` | Spend tokens, award a caged professor, and update pity atomically |
| GET | `/api/inventory` | Owned professors |
| POST | `/api/inventory/level-up` | Spend spare copies |
| GET | `/api/question` | Player-owned question attempt, no answer or explanation |
| POST | `/api/question/answer` | Submit `{ questionId, selectedIndex }` |
| POST | `/api/battle/start` | Start/retry a Rare or Epic encounter with `{ encounterId, professorId, fighterId? }`. `fighterId` is a professor the player owns and sends out; without it the student fights |
| GET | `/api/battle/:id` | Owned battle state; settles expired questions |
| GET | `/api/battle/:id/question` | Generate/retrieve the current private battle question |
| POST | `/api/battle/:id/action` | Attack, answer, timeout, or flee with an idempotent action ID and expected version |
| POST | `/api/battle/:id/catch` | After a win, spend one owned cage `{ cageId }` to add the defeated professor to the inventory; once per battle |

Accounts begin with 50 tokens; a pull costs 10. Professor IDs remain stable inventory keys, and duplicates add copies. Level-up retains at least one copy.

### Recruitment rules

The roster lives in `src/server/modules/recruitment/domain/professors.ts`; policy lives in `src/server/modules/recruitment/application/recruitment.ts`.

- Legendary professors share a 0.08% base chance. After 50 pulls without one, the chance rises linearly to a guarantee on pull 80.
- Epic professors share a 5% base chance. The 10th pull without an Epic or Legendary guarantees an Epic unless it is Legendary; Legendary takes precedence when both guarantees are due. Either rarity restarts the 10-pull count.
- Every pull is a professor. Rare and Common professors share the remaining ~95% equally. The roster must contain a Legendary, an Epic, and a Rare or Common professor; IDs, departments, ratings, stats and copy costs remain validated.
- Each professor arrives in the cage for their rarity: golden for Legendary, iron for Epic, bronze for Rare and Common. Cages are not separate prizes; the old `items` table is left in place but unused. Player counters live in `gacha_pity`. Token debit, professor and counters are saved atomically.

Pool responses include `{ cost, professors, cages }`, and each professor has a `cage`. Pity responses are `{ cost, guarantee, pity }`. Pull responses are `{ item, isNew, pity, user }`. Inventory returns `{ inventory }`.

### Recruit page

**Recruit a professor** in the lobby opens the gashapon (`src/client/pages/RecruitPage/`). A pull shakes the machine and tumbles the capsules in its globe while the server picks the professor. A capsule then drops out of the chute, wobbles (longer for a Legendary) and pops open to show the professor inside their cage. The capsule colour shows the rarity: yellow Legendary, pink Epic, blue Rare, green Common. A card lists their rarity, department, cage, stats and copies.

The pity bar shows pulls toward the guaranteed Epic or Legendary and turns gold when the next pull is guaranteed. It and the token balance update only once the capsule opens, so the bar never gives the result away. **Skip** jumps to the result, and players who prefer reduced motion see the result straight away. With too few tokens, the page links to the pop quiz. The capsule physics are in `src/client/features/recruitment/capsules.ts`. The page imports only the pictures it uses from `Assets/gacha/`, and only those are published.

### Campus map

The lobby's **Explore the campus** button opens a top-down open world, drawn on a canvas. Map movement and spawning run in the browser; fights run on the server:

- The world is 5 × 5 screens of 12 × 12 tiles. The player starts at their house in the middle screen (C3) and walks in 8 directions with WASD, the arrow keys, or the on-screen pad.
- Walking off a screen's edge arrives at the opposite edge of the next screen; walking off the world's edge wraps around to the other side. Signposts on each edge name the next screen.
- Scenery is generated from a fixed seed, so the map is the same on every visit. Blocking scenery stays off each screen's outer ring, so every screen can be crossed. Only a tree's trunk blocks the player; they can walk under its leaves, which then hide them.
- **Wild professors** are the Rare and Epic ones (from `GET /api/gacha/pool`). They appear at random on the campus and inside the school, never at home, at most 6 at once, a new one every 5–12 seconds, always within 16 tiles of the player so one is usually in sight. They roam as animated stickmen, crossing from screen to screen but keeping off the home screen. Walking up to one shows an encounter card where the player chooses who to send out (one of their professors, or themselves), with **Fight professor** and **Keep exploring**. Spawns are not saved or server-checked.
- **Buildings:** the house (screen C3) and the school (screen D3) can be entered by pressing F at the door, and left the same way. Each is one room built from the pictures in `Assets/`; the side and bottom walls are black lines.
- **Battles** take over the map with the clearing from `Assets/fighting_scene/`. Both fighters shake left and right, attacks play as punches, and the three timed quizzes interrupt as before. A sent-out professor fights with its own stats (see `professorFighter` in the game engine); each level above 1 adds 10% health and attack. After a win the player can throw one of their cages to catch the professor, or let them go. Battles grant no tokens.
- **Gashapon machine:** it stands in the school; press F in front of it. Capsules tumble in the globe with simple physics, and the player can pull 1 or 10. Each capsule rolls out, splits in half, and reveals the prize: a professor in a cage (gold for Legendary, copper otherwise) or a cage.
- **Teacher:** a teacher stands at the blackboard in the school; press F beside them for a quiz. Each correct answer to a teacher's question earns 10 tokens (`GET /api/question?from=teacher`); the reward is saved with the question on the server. The lobby quiz still earns 1.
- **Stickmen:** the player and the professors are drawn with the rig from `Assets/stickman-react`, ported to TypeScript in `src/client/features/stickman/` and animated with GSAP. Their head pictures are in `Assets/stickman/heads/`.

Map mechanics live in `src/client/features/world/Game Mechanics/`: the campus rules (layout, walking, wrapping, collisions, spawns, doors) in `world.ts`, the room rules in `rooms.ts`, the capsule physics in `capsules.ts`, tests in `tests/`, and the game loop in `game.ts`. Battle/health rules live in `BackEnd/Game Engine/encounterBattle.ts`, SQLite battle storage in `BackEnd/Persistence Layer/encounterBattles.ts`, and authenticated routes in `src/server/modules/battles/`. Drawing is in `features/world/renderer.ts`, and the pages in `pages/WorldPage/` (`WorldPage`, `ActorLayer`, `BattleEncounter`, `Gashapon`). Only the artwork imported by `features/world/art.ts` and `features/stickman/looks.ts` is published; the outsides of the house and school are drawn in code.

### Wild battle quizzes

- This first encounter fight uses a student with 100 HP, 600 attack, and 20 defense as temporary combat defaults. Professors use their roster stats. A turn deals `floor(attack / defense)` damage in each direction; health cannot go below zero. Team selection and level-based stats are future work.
- Each battle rolls a whole-HP trigger inside **2/3–3/4** of maximum professor health, another inside **1/3–3/5**, and a final trigger at **10%** (whole HP rounded down). Each event fires once, even if healing raises HP above an earlier trigger.
- A strike pauses at a crossed checkpoint. Its remaining damage resumes after the quiz; a large or lethal strike can therefore interrupt for several quizzes before finishing. The professor counterattacks once when that strike finishes, unless defeated.
- Each popup reuses the Gemini coding-question generator and local fallback. Combat pauses while the question is generated. The server starts a **10-second** deadline after generation. An incorrect answer or timeout heals the professor by `floor((maxHP - currentHP) * percent / 100)`, where `percent` is a uniformly random integer from **50 through 80**, and costs the player `floor(currentPlayerHP * 80 / 100)` health. Both penalties apply before the interrupted strike resumes; the usual professor counterattack can cause defeat afterward. Correct answers apply neither penalty. These battle questions do not award practice tokens.
- Battle state, the private answer, deadlines, and processed action IDs persist in SQLite. Answers are tied to the player's current battle question. Late answers count as wrong; explicit retries cannot apply damage or healing twice. Network failures show Retry; stale versions require Refresh battle. The browser map and encounter identity still reset on reload, so there is no resume-battle UI or reward-bearing encounter validation yet.

Question correctness and rewards remain server-owned. A correct first answer awards one token atomically with the recorded choice. Same-choice retries are idempotent; changed answers are rejected. A lost response enables only explicit same-choice retry in the UI, not automatic resubmission. React renders generated/player content as text.

### Animated encounter fights

Campus fights show two articulated SVG professors, adapted from `Assets/stickman-react.zip`, with the transparent head cutouts in `Assets/battle/heads/`. `src/client/features/battle/` contains the reusable rig, typed GSAP controller, fighter artwork mapping, and the battle arena.

Before the first attack, **Battle as** lets the player choose a professor from their authenticated inventory. Empty collections use a student practice fighter. Professor selection currently changes the fighter's appearance; existing student practice stats and server combat rules are retained. It does not implement team combat or level-based battle stats.

Confirmed battle results trigger player lunges/punches, enemy hit reactions and counterattacks, quiz healing, victory waves, defeat poses, and fleeing. Loading a question or retrying an already processed command cannot replay a hit. The server remains the only authority for health, damage, question deadlines and healing. Combat controls wait for attack animations; quiz answers and their ten-second countdown remain available during visual transitions. Reduced-motion preferences suppress continuous movement while retaining the outcome poses and feedback.

The arena scales for desktop/mobile and compacts while a timed question is open. Timelines and preference listeners are cleaned up on unmount. The original demo's fixed 25-HP damage and automatic enemy respawn are not used. Only explicitly imported artwork is bundled; the ZIP and demo files stay private.
