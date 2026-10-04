-- Questions issued to players, including the private answer and the submitted choice.
-- The submission and token reward are saved in one transaction to prevent repeat rewards.
CREATE TABLE IF NOT EXISTS question_attempts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    question_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    selected_index INTEGER CHECK (selected_index BETWEEN 0 AND 3),
    answered_at INTEGER
);
CREATE INDEX IF NOT EXISTS question_attempts_user_id ON question_attempts(user_id);
