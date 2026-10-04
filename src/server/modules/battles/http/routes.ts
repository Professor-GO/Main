import { randomUUID } from "node:crypto";
import {
  createCombat,
  prepareSummons,
  summon,
  enemyStrike,
  resolveQuiz,
  strike,
  WILD_LEVELS,
  WILD_RARITIES,
} from "../domain/encounterBattle.ts";
import {
  changeBattle,
  installQuiz,
  publicBattle,
  readBattle,
  saveBattle,
} from "../infrastructure/sqliteEncounterBattles.ts";
import type { AppContext } from "../../../http/apiApp.ts";
import {
  allowMethods,
  createRouter,
  httpError,
  jsonBody,
} from "../../../http/http.ts";
import {
  checkOrigin,
  rateLimiter,
  requireUser,
} from "../../accounts/http/session.ts";
import {
  GACHA_POOL,
  inventoryFor,
} from "../../recruitment/application/recruitment.ts";
import { createCodingQuestion } from "../../questions/infrastructure/gemini.ts";
import type { Battle } from "../infrastructure/sqliteEncounterBattles.ts";

const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

/** Resolves a private question, including the server-enforced ten-second deadline. */
function answerBattle(battle: Battle, selectedIndex: number | null): Battle {
  if (battle.combat.status !== "question" || !battle.quiz)
    throw httpError(409, "There is no question to answer.");
  const timedOut = Date.now() >= battle.quiz.expiresAt;
  if (selectedIndex === null && !timedOut)
    throw httpError(409, "There is still time to answer.");
  const correct = !timedOut && selectedIndex === battle.quiz.answerIndex;
  const { state, healed, healingPercent, playerDamage } = resolveQuiz(
    battle.combat,
    correct,
  );
  return {
    ...battle,
    combat: state,
    quiz: null,
    feedback: {
      correct,
      timedOut,
      answerIndex: battle.quiz.answerIndex,
      explanation: battle.quiz.explanation,
      healed,
      healingPercent,
      playerDamage,
    },
  };
}

/** Settles expired questions when a player reloads or returns to the battle. */
function settleExpired(
  db: AppContext["db"],
  userId: string,
  id: string,
): Battle {
  const battle = readBattle(db, userId, id);
  if (
    battle.combat.status !== "question" ||
    !battle.quiz ||
    Date.now() < battle.quiz.expiresAt
  )
    return battle;
  return changeBattle(
    db,
    userId,
    id,
    battle.quiz.id,
    battle.version,
    { kind: "timeout" },
    (current) => answerBattle(current, null),
  );
}

/** Authenticated wild encounters. Quiz correctness and healing never come from the browser. */
export function battleRoutes({ db, auth }: AppContext) {
  const router = createRouter();
  const generating = new Map<string, Promise<void>>();
  router
    .route("/battle/start")
    .all(allowMethods("POST"))
    .post(checkOrigin, rateLimiter(30), jsonBody, async (request, response) => {
      const user = await requireUser(auth, request);
      const { encounterId, professorId, level } = request.body;
      if (!uuid(encounterId)) throw httpError(400, "Choose a valid encounter.");
      // The level the professor rolled when they appeared on the campus map.
      if (
        !Number.isInteger(level) ||
        level < WILD_LEVELS.min ||
        level > WILD_LEVELS.max
      )
        throw httpError(
          400,
          `Choose a level from ${WILD_LEVELS.min} to ${WILD_LEVELS.max}.`,
        );
      const professor = GACHA_POOL.find(
        (entry) =>
          entry.id === professorId && WILD_RARITIES.includes(entry.rarity),
      );
      if (!professor)
        throw httpError(400, "This professor cannot appear in the overworld.");
      response.json(
        publicBattle(
          saveBattle(db, user.id, {
            id: encounterId,
            professorId: professor.id,
            professorName: professor.name,
            version: 0,
            combat: prepareSummons(
              createCombat(professor.stats, Math.random, level),
              inventoryFor(db, user.id).map((item) => ({
                id: item.professor.id,
                name: item.professor.name,
                level: item.level,
                stats: item.professor.stats,
                defeated: false,
              })),
            ),
            quiz: null,
            feedback: null,
          }),
        ),
      );
    });
  router
    .route("/battle/:id")
    .all(allowMethods("GET"))
    .get(checkOrigin, rateLimiter(90), async (request, response) => {
      const user = await requireUser(auth, request);
      response.json(
        publicBattle(settleExpired(db, user.id, String(request.params.id))),
      );
    });
  router
    .route("/battle/:id/question")
    .all(allowMethods("GET"))
    .get(checkOrigin, rateLimiter(30), async (request, response) => {
      const user = await requireUser(auth, request);
      const id = String(request.params.id);
      const battle = readBattle(db, user.id, id);
      if (battle.combat.status !== "question")
        throw httpError(409, "There is no battle question right now.");
      if (!battle.quiz) {
        const key = `${user.id}:${id}:${battle.version}`;
        let pending = generating.get(key);
        if (!pending) {
          pending = (async () => {
            const question = await createCodingQuestion();
            installQuiz(db, user.id, battle, {
              ...question,
              id: randomUUID(),
              expiresAt: Date.now() + 10_000,
            });
          })();
          generating.set(key, pending);
          pending.finally(() => generating.delete(key)).catch(() => {});
        }
        await pending;
      }
      response.json(publicBattle(settleExpired(db, user.id, id)));
    });
  router
    .route("/battle/:id/action")
    .all(allowMethods("POST"))
    .post(
      checkOrigin,
      // Real-time fights send one action per landed punch, from both fighters.
      rateLimiter(240),
      jsonBody,
      async (request, response) => {
        const user = await requireUser(auth, request);
        const {
          actionId,
          version,
          kind,
          questionId,
          selectedIndex,
          professorId,
        } = request.body;
        if (
          !uuid(actionId) ||
          !Number.isSafeInteger(version) ||
          version < 0 ||
          ![
            "summon",
            "attack",
            "enemyAttack",
            "answer",
            "timeout",
            "flee",
          ].includes(kind)
        )
          throw httpError(400, "Choose a valid battle action.");
        if (
          kind === "answer" &&
          (!uuid(questionId) ||
            !Number.isInteger(selectedIndex) ||
            selectedIndex < 0 ||
            selectedIndex > 3)
        )
          throw httpError(400, "Choose one of the four answers.");
        if (kind === "summon" && typeof professorId !== "string")
          throw httpError(400, "Choose a professor to summon.");
        const command = {
          kind,
          version,
          ...(kind === "answer" ? { questionId, selectedIndex } : {}),
          ...(kind === "summon" ? { professorId } : {}),
        };
        const result = changeBattle(
          db,
          user.id,
          String(request.params.id),
          actionId,
          version,
          command,
          (battle) => {
            if (kind === "summon") {
              if (
                battle.combat.status !== "summoning" ||
                !battle.combat.fighters?.some(
                  (fighter) => fighter.id === professorId && !fighter.defeated,
                )
              )
                throw httpError(
                  409,
                  "Choose an available professor from your collection.",
                );
              return {
                ...battle,
                combat: summon(battle.combat, professorId),
                feedback: null,
              };
            }
            if (kind === "attack") {
              if (battle.combat.status !== "fighting")
                throw httpError(
                  409,
                  "Finish the current question before attacking.",
                );
              return {
                ...battle,
                combat: strike(battle.combat),
                quiz: null,
                feedback: null,
              };
            }
            if (kind === "enemyAttack") {
              if (battle.combat.status !== "fighting")
                throw httpError(409, "The fight is paused.");
              return {
                ...battle,
                combat: enemyStrike(battle.combat),
                quiz: null,
                feedback: null,
              };
            }
            if (kind === "flee") {
              if (
                !["summoning", "fighting", "question"].includes(
                  battle.combat.status,
                )
              )
                throw httpError(409, "This battle has ended.");
              return {
                ...battle,
                combat: { ...battle.combat, status: "fled" },
                quiz: null,
                feedback: null,
              };
            }
            if (kind === "timeout") return answerBattle(battle, null);
            if (
              battle.combat.status !== "question" ||
              !battle.quiz ||
              battle.quiz.id !== questionId
            )
              throw httpError(409, "Answer the current battle question.");
            return answerBattle(battle, selectedIndex);
          },
        );
        response.json(publicBattle(result));
      },
    );
  return router;
}
