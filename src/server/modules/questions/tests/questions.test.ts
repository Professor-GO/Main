import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../../storage/database.ts";
import { STARTING_TOKENS, createAuth } from "../../accounts/infrastructure/betterAuth.ts";
import { fallbackCodingQuestion } from "../infrastructure/gemini.ts";
import { TEACHER_QUESTION_REWARD, answerQuestion, saveQuestion } from "../infrastructure/sqliteQuestions.ts";

test("question rewards persist atomically, reject expired attempts, and respect account status", async (t) => {
    const db = openDatabase(":memory:");
    const auth = await createAuth(db, { baseURL: "http://localhost:3000", secret: "question-test-secret-that-is-long-enough", production: false });
    await auth.$context;
    t.after(() => db.close());
    const { user } = await auth.api.signUpEmail({ body: { name: "QuizPlayer", username: "QuizPlayer", email: "quiz@example.invalid", password: "test-password-123" } });
    const question = fallbackCodingQuestion();
    const issued = saveQuestion(db, user.id, { ...question, source: "gemini" });
    assert.equal(issued.source, "gemini");
    assert.equal("answerIndex" in issued, false);
    assert.equal("explanation" in issued, false);

    // A failed write must leave both the balance and the unanswered attempt untouched.
    db.exec("CREATE TRIGGER fail_question_save BEFORE UPDATE ON question_attempts BEGIN SELECT RAISE(ABORT, 'test write failure'); END;");
    assert.throws(() => answerQuestion(db, user.id, issued.id, question.answerIndex), /test write failure/);
    assert.equal(db.prepare('SELECT tokens FROM "user" WHERE id = ?').get(user.id)?.tokens, STARTING_TOKENS);
    assert.equal(db.prepare("SELECT selected_index FROM question_attempts WHERE id = ?").get(issued.id)?.selected_index, null);
    assert.equal(db.isTransaction, false);
    db.exec("DROP TRIGGER fail_question_save");
    const answer = answerQuestion(db, user.id, issued.id, question.answerIndex);
    assert.ok(!("error" in answer));
    assert.equal(answer.tokensAwarded, 1);
    assert.equal(answer.tokens, STARTING_TOKENS + 1);

    // The teacher's questions pay more, the reward is not shown to the browser, and a wrong answer pays nothing.
    const fromTeacher = saveQuestion(db, user.id, question, TEACHER_QUESTION_REWARD);
    assert.equal("reward" in fromTeacher, false);
    const paid = answerQuestion(db, user.id, fromTeacher.id, question.answerIndex);
    assert.ok(!("error" in paid));
    // The starting balance, plus one for the first answer, plus the teacher's reward.
    const afterTeacher = STARTING_TOKENS + 1 + TEACHER_QUESTION_REWARD;
    assert.deepEqual([paid.tokensAwarded, paid.tokens], [10, afterTeacher]);
    const again = answerQuestion(db, user.id, fromTeacher.id, question.answerIndex);
    assert.ok(!("error" in again));
    assert.deepEqual([again.tokensAwarded, again.tokens], [0, afterTeacher]);
    const missed = saveQuestion(db, user.id, question, TEACHER_QUESTION_REWARD);
    const wrong = answerQuestion(db, user.id, missed.id, (question.answerIndex + 1) % 4);
    assert.ok(!("error" in wrong));
    assert.deepEqual([wrong.tokensAwarded, wrong.tokens], [0, afterTeacher]);

    const expired = saveQuestion(db, user.id, question);
    db.prepare("UPDATE question_attempts SET expires_at = 0 WHERE id = ?").run(expired.id);
    assert.deepEqual(answerQuestion(db, user.id, expired.id, question.answerIndex), { error: "expired" });
    const inactive = saveQuestion(db, user.id, question);
    db.prepare('UPDATE "user" SET isActive = 0 WHERE id = ?').run(user.id);
    assert.deepEqual(answerQuestion(db, user.id, inactive.id, question.answerIndex), { error: "inactive" });
    assert.equal(db.prepare('SELECT tokens FROM "user" WHERE id = ?').get(user.id)?.tokens, afterTeacher);
    assert.equal(db.prepare("SELECT selected_index FROM question_attempts WHERE id = ?").get(inactive.id)?.selected_index, null);
});
