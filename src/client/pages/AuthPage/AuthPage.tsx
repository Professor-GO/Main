/** Account form keeps credentials local and uses the established auth commands. */
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { errorMessage } from "../../api/request";
import { account } from "../../features/accounts/api";
import type { Player } from "../../features/accounts/api";
import "./AuthPage.css";

type AuthPageProps = {
  restoring: boolean;
  message: string;
  focus: boolean;
  onAuthenticated: (player: Player) => void;
};
export default function AuthPage({
  restoring,
  message,
  focus,
  onAuthenticated,
}: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const [credentials, setCredentials] = useState({
    username: "",
    password: "",
    confirmation: "",
  });
  const [sessionMessage, setSessionMessage] = useState(message);
  const username = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const confirm = useRef<HTMLInputElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const signup = mode === "register";
  useEffect(() => {
    setSessionMessage(message);
  }, [message]);
  useEffect(() => {
    document.title = "Professor-Go — Class is in session";
    if (focus) username.current?.focus();
  }, [focus]);
  function changeMode(next: "login" | "register") {
    if (pending) return;
    setMode(next);
    setError("");
    setCredentials((current) => ({ ...current, confirmation: "" }));
    confirm.current?.setCustomValidity("");
  }
  function key(event: KeyboardEvent, index: number) {
    if (
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) ||
      pending
    )
      return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
    tabs.current[next]?.focus();
    changeMode(next === 0 ? "login" : "register");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || restoring) return;
    if (signup && credentials.password !== credentials.confirmation) {
      confirm.current?.setCustomValidity("Your passwords don’t match yet.");
      confirm.current?.reportValidity();
      return;
    }
    setPending(true);
    setError("");
    setSessionMessage("");
    try {
      onAuthenticated(
        await account(mode, {
          username: credentials.username.trim(),
          password: credentials.password,
        }),
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }
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
          {(["Log in", "Create account"] as const).map((label, index) => (
            <button
              key={label}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              id={index ? "signup-tab" : "login-tab"}
              className="auth-tab"
              type="button"
              role="tab"
              aria-selected={signup === Boolean(index)}
              aria-controls="auth-panel"
              tabIndex={signup === Boolean(index) ? 0 : -1}
              disabled={pending}
              onClick={() => changeMode(index ? "register" : "login")}
              onKeyDown={(event) => key(event, index)}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          id="auth-panel"
          role="tabpanel"
          aria-labelledby={signup ? "signup-tab" : "login-tab"}
        >
          <p className="form-intro" id="form-intro">
            {signup
              ? "A new semester. A new contender. Let’s get you in."
              : "Welcome back. Your faculty awaits."}
          </p>
          <form
            id="auth-form"
            aria-busy={pending}
            onSubmit={submit}
            onInput={() => {
              setError("");
              confirm.current?.setCustomValidity("");
            }}
          >
            <fieldset
              id="auth-fields"
              aria-label="Player credentials"
              disabled={pending || restoring}
            >
              <label htmlFor="username">Username</label>
              <input
                ref={username}
                value={credentials.username}
                onChange={(event) =>
                  setCredentials({
                    ...credentials,
                    username: event.target.value,
                  })
                }
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
              <p className="field-hint" id="username-hint" hidden={!signup}>
                3–20 letters, numbers, or underscores.
              </p>
              <div className="password-label">
                <label htmlFor="password">Password</label>
                <span
                  className="field-optional"
                  id="password-hint"
                  hidden={!signup}
                >
                  At least 8 characters
                </span>
              </div>
              <div className="password-input">
                <input
                  ref={password}
                  value={credentials.password}
                  onChange={(event) =>
                    setCredentials({
                      ...credentials,
                      password: event.target.value,
                    })
                  }
                  id="password"
                  name="password"
                  type={show ? "text" : "password"}
                  autoComplete={signup ? "new-password" : "current-password"}
                  placeholder={
                    signup ? "Create a strong password" : "Enter your password"
                  }
                  required
                  minLength={8}
                  maxLength={128}
                  aria-describedby="password-hint"
                />
                <button
                  id="toggle-password"
                  className="show-password"
                  type="button"
                  aria-label={show ? "Hide password" : "Show password"}
                  aria-pressed={show}
                  onClick={() => setShow(!show)}
                >
                  {show ? "Hide" : "Show"}
                </button>
              </div>
              <div id="confirm-field" hidden={!signup}>
                <label htmlFor="confirm-password">Confirm password</label>
                <input
                  ref={confirm}
                  value={credentials.confirmation}
                  onChange={(event) =>
                    setCredentials({
                      ...credentials,
                      confirmation: event.target.value,
                    })
                  }
                  id="confirm-password"
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="One more time"
                  maxLength={128}
                  required={signup}
                />
              </div>
              <p
                id="form-message"
                className="form-message"
                role="alert"
                hidden={!error}
              >
                {error}
              </p>
              <button
                id="submit-button"
                className="primary-button"
                type="submit"
              >
                <span id="submit-label">
                  {pending
                    ? signup
                      ? "Creating your account…"
                      : "Entering the arena…"
                    : signup
                      ? "Create your player account"
                      : "Enter the arena"}
                </span>
                <span aria-hidden="true">→</span>
              </button>
            </fieldset>
          </form>
          <p className="form-note" id="form-note">
            {signup
              ? "Pick your player name. Your campus story starts here."
              : "Good to see you again. Let’s make the dean’s list."}
          </p>
        </div>
      </div>
      <p className="session-status" id="session-status" role="status">
        {sessionMessage}
      </p>
    </div>
  );
}
