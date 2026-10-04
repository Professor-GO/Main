import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/request";
import { logout } from "../../features/accounts/api";
import type { Player } from "../../features/accounts/api";
import "./LobbyPage.css";

type LobbyPageProps = {
  player: Player;
  focus: boolean;
  onQuestion: () => void;
  onLogout: () => void;
};
export default function LobbyPage({
  player,
  focus,
  onQuestion,
  onLogout,
}: LobbyPageProps) {
  const title = useRef<HTMLHeadingElement>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    document.title = `${player.username} · Professor-Go`;
    if (focus) title.current?.focus();
  }, [player.username, focus]);
  async function signOut() {
    if (pending) return;
    setPending(true);
    try {
      await logout();
      onLogout();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }
  return (
    <section id="lobby-view" aria-labelledby="lobby-title">
      <p className="eyebrow">
        <span className="tiny-cross" aria-hidden="true">
          ✦
        </span>{" "}
        YOU’RE ON THE ROSTER
      </p>
      <h1 ref={title} id="lobby-title" tabIndex={-1}>
        Welcome to
        <br />
        the faculty<span className="accent-dot">.</span>
      </h1>
      <p className="intro">
        You’re in, <strong id="player-name">{player.username}</strong>.<br />
        Your campus adventure starts here.
      </p>
      <div className="player-pass">
        <div className="pass-heading">
          <span className="eyebrow">PROFESSOR-GO / PLAYER PASS</span>
          <span className="active-badge">● ACTIVE</span>
        </div>
        <div className="pass-player">
          <span
            className="player-avatar"
            id="player-initial"
            aria-hidden="true"
          >
            {player.username[0].toUpperCase()}
          </span>
          <div>
            <span className="field-optional">PLAYER</span>
            <h2 id="pass-name">{player.username}</h2>
          </div>
        </div>
        <dl className="pass-details">
          <div>
            <dt>Enrolled on</dt>
            <dd id="account-date">
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
              }).format(new Date(player.createdAt))}
            </dd>
          </div>
          <div>
            <dt>Account status</dt>
            <dd id="account-status">
              {player.isActive ? "Active" : "Inactive"}
            </dd>
          </div>
          <div>
            <dt>Tokens</dt>
            <dd id="account-tokens">
              {new Intl.NumberFormat().format(player.tokens)}
            </dd>
          </div>
        </dl>
      </div>
      <div className="lobby-actions">
        <button
          className="primary-button"
          id="recruit-button"
          type="button"
          onClick={() =>
            setStatus(
              "The recruitment hall is still being built. Check back soon!",
            )
          }
        >
          <span>Recruit a professor</span>
          <span aria-hidden="true">✦</span>
        </button>
        <button
          className="primary-button"
          id="battle-button"
          type="button"
          onClick={() =>
            setStatus("The battle arena is still being built. Check back soon!")
          }
        >
          <span>Build a team &amp; battle</span>
          <span aria-hidden="true">⚔︎</span>
        </button>
        <button
          className="primary-button"
          id="tokens-button"
          type="button"
          onClick={onQuestion}
        >
          <span>Get tokens</span>
          <span aria-hidden="true">?</span>
        </button>
      </div>
      <p className="session-status" id="lobby-status" role="status">
        {status}
      </p>
      <p className="lobby-note">
        Your account is ready. Recruiting and battles are still being built —
        check back for your first class.
      </p>
      <p
        id="lobby-message"
        className="form-message"
        role="alert"
        hidden={!error}
      >
        {error}
      </p>
      <button
        className="secondary-button"
        id="logout-button"
        type="button"
        disabled={pending}
        onClick={signOut}
      >
        Log out <span aria-hidden="true">↗</span>
      </button>
    </section>
  );
}
