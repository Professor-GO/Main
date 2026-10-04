import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../../storage/database.ts";
import { createAuth } from "../../accounts/infrastructure/betterAuth.ts";
import { fallbackCodingQuestion } from "../infrastructure/gemini.ts";
import { answerQuestion, saveQuestion } from "../infrastructure/sqliteQuestions.ts";

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
    assert.equal(db.prepare('SELECT tokens FROM "user" WHERE id = ?').get(user.id)?.tokens, 50);
    assert.equal(db.prepare("SELECT selected_index FROM question_attempts WHERE id = ?").get(issued.id)?.selected_index, null);
    assert.equal(db.isTransaction, false);
    db.exec("DROP TRIGGER fail_question_save");
    const answer = answerQuestion(db, user.id, issued.id, question.answerIndex);
    assert.ok(!("error" in answer));
    assert.equal(answer.tokensAwarded, 1);
    assert.equal(answer.tokens, 51);

    const expired = saveQuestion(db, user.id, question);
    db.prepare("UPDATE question_attempts SET expires_at = 0 WHERE id = ?").run(expired.id);
    assert.deepEqual(answerQuestion(db, user.id, expired.id, question.answerIndex), { error: "expired" });
    const inactive = saveQuestion(db, user.id, question);
    db.prepare('UPDATE "user" SET isActive = 0 WHERE id = ?').run(user.id);
    assert.deepEqual(answerQuestion(db, user.id, inactive.id, question.answerIndex), { error: "inactive" });
    assert.equal(db.prepare('SELECT tokens FROM "user" WHERE id = ?').get(user.id)?.tokens, 51);
    assert.equal(db.prepare("SELECT selected_index FROM question_attempts WHERE id = ?").get(inactive.id)?.selected_index, null);
});
