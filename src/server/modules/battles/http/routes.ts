import { randomUUID } from "node:crypto";
import {
  createCombat,
  resolveQuiz,
  strike,
} from "../../../../../BackEnd/Game Engine/encounterBattle.ts";
import {
  changeBattle,
  installQuiz,
  markCaught,
  publicBattle,
  readBattle,
  saveBattle,
} from "../../../../../BackEnd/Persistence Layer/encounterBattles.ts";
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
  GACHA_CAGES,
  GACHA_POOL,
  inventoryFor,
} from "../../recruitment/application/recruitment.ts";
import { catchWithCage } from "../../recruitment/infrastructure/sqliteInventory.ts";
import { professorFighter } from "../../../../../BackEnd/Game Engine/encounterBattle.ts";
import { createCodingQuestion } from "../../questions/infrastructure/gemini.ts";
import type { Battle } from "../../../../../BackEnd/Persistence Layer/encounterBattles.ts";

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
  const { state, healed, healingPercent } = resolveQuiz(battle.combat, correct);
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
      const { encounterId, professorId, fighterId } = request.body;
      if (!uuid(encounterId)) throw httpError(400, "Choose a valid encounter.");
      // Only Rare and Epic professors roam wild; the others are recruited at the gashapon machine.
      const professor = GACHA_POOL.find(
        (entry) =>
          entry.id === professorId && ["Rare", "Epic"].includes(entry.rarity),
      );
      if (!professor)
        throw httpError(400, "This professor cannot appear in the overworld.");
      // The player may send out a professor they own; otherwise the student fights.
      let fighter;
      if (fighterId !== undefined && fighterId !== null) {
        const owned = inventoryFor(db, user.id).find(
          (item) => item.professor.id === fighterId,
        );
        if (!owned) throw httpError(404, "You don't have that professor yet.");
        fighter = professorFighter(owned.professor.stats, owned.level);
      }
      response.json(
        publicBattle(
          saveBattle(db, user.id, {
            id: encounterId,
            professorId: professor.id,
            professorName: professor.name,
            fighterId: fighter ? fighterId : null,
            version: 0,
            combat: createCombat(professor.stats, Math.random, fighter),
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
  // Throws a cage at a defeated professor to catch them. The cage is spent and the professor
  // joins the player's inventory, both in one transaction, and only once per battle.
  router
    .route("/battle/:id/catch")
    .all(allowMethods("POST"))
    .post(checkOrigin, rateLimiter(30), jsonBody, async (request, response) => {
      const user = await requireUser(auth, request);
      const id = String(request.params.id);
      const { cageId } = request.body;
      if (!GACHA_CAGES.some((cage) => cage.id === cageId))
        throw httpError(400, "Choose one of your cages.");
      db.exec("BEGIN IMMEDIATE");
      try {
        const battle = readBattle(db, user.id, id);
        if (battle.combat.status !== "won")
          throw httpError(409, "Defeat the professor before trying to catch them.");
        if (battle.caught)
          throw httpError(409, "You have already caught this professor.");
        const caught = catchWithCage(db, user.id, cageId, battle.professorId);
        if (!caught) throw httpError(409, "You don't have that cage.");
        const next = markCaught(db, user.id, battle);
        db.exec("COMMIT");
        const item = inventoryFor(db, user.id).find(
          (owned) => owned.professor.id === battle.professorId,
        );
        response.json({
          battle: publicBattle(next),
          item,
          isNew: caught.row.copies === 1,
          cagesLeft: caught.cagesLeft,
        });
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    });
  router
    .route("/battle/:id/action")
    .all(allowMethods("POST"))
    .post(
      checkOrigin,
      rateLimiter(120),
      jsonBody,
      async (request, response) => {
        const user = await requireUser(auth, request);
        const { actionId, version, kind, questionId, selectedIndex } =
          request.body;
        if (
          !uuid(actionId) ||
          !Number.isSafeInteger(version) ||
          version < 0 ||
          !["attack", "answer", "timeout", "flee"].includes(kind)
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
        const command = {
          kind,
          version,
          ...(kind === "answer" ? { questionId, selectedIndex } : {}),
        };
        const result = changeBattle(
          db,
          user.id,
          String(request.params.id),
          actionId,
          version,
          command,
          (battle) => {
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
            if (kind === "flee") {
              if (!["fighting", "question"].includes(battle.combat.status))
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
