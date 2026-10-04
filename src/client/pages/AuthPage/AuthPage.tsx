/** Preserves the initial disabled account-access view until session commands are wired. */
import "./AuthPage.css";

/** Renders the original restoration state without issuing requests in this foundation slice. */
export default function AuthPage() {
  return (
    <div id="auth-view">
      <p className="eyebrow">
        <span className="tiny-cross" aria-hidden="true">
          ✦
        </span>{" "}
        WELCOME TO YOUR NEXT OBSESSION
      </p>
      <h1>
        Big brains.
        <br />
        Bigger battles<span className="accent-dot">.</span>
      </h1>
      <p className="intro">
        Your professors. Your dream team.
        <br />A whole new kind of campus rivalry.
      </p>
      <div className="auth-box">
        <div className="auth-tabs" role="tablist" aria-label="Account access">
          <button
            id="login-tab"
            className="auth-tab"
            type="button"
            role="tab"
            aria-selected="true"
            aria-controls="auth-panel"
          >
            Log in
          </button>
          <button
            id="signup-tab"
            className="auth-tab"
            type="button"
            role="tab"
            aria-selected="false"
            aria-controls="auth-panel"
            tabIndex={-1}
          >
            Create account
          </button>
        </div>
        <div id="auth-panel" role="tabpanel" aria-labelledby="login-tab">
          <p className="form-intro" id="form-intro">
            Welcome back. Your faculty awaits.
          </p>
          <form id="auth-form">
            <fieldset id="auth-fields" aria-label="Player credentials" disabled>
              <label htmlFor="username">Username</label>
              <input
                id="username"
                name="username"
                autoComplete="username"
                placeholder="Your player name"
                required
                minLength={3}
                maxLength={20}
                pattern="[a-zA-Z0-9_]{3,20}"
                title="3–20 letters, numbers, or underscores"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby="username-hint"
              />
              <p className="field-hint" id="username-hint" hidden>
                3–20 letters, numbers, or underscores.
              </p>
              <div className="password-label">
                <label htmlFor="password">Password</label>
                <span className="field-optional" id="password-hint" hidden>
                  At least 8 characters
                </span>
              </div>
              <div className="password-input">
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  required
                  minLength={8}
                  maxLength={128}
                  aria-describedby="password-hint"
                />
                <button
                  id="toggle-password"
                  className="show-password"
                  type="button"
                  aria-label="Show password"
                  aria-pressed="false"
                >
                  Show
                </button>
              </div>
              <div id="confirm-field" hidden>
                <label htmlFor="confirm-password">Confirm password</label>
                <input
                  id="confirm-password"
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="One more time"
                  maxLength={128}
                />
              </div>
              <p
                id="form-message"
                className="form-message"
                role="alert"
                hidden
              />
              <button
                id="submit-button"
                className="primary-button"
                type="submit"
              >
                <span id="submit-label">Enter the arena</span>
                <span aria-hidden="true">→</span>
              </button>
            </fieldset>
          </form>
          <p className="form-note" id="form-note">
            Good to see you again. Let’s make the dean’s list.
          </p>
        </div>
      </div>
      <p className="session-status" id="session-status" role="status">
        Checking your player pass…
      </p>
    </div>
  );
}
