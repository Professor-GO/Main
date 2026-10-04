/** Coordinates session lifetime and local page selection without a router or global store. */
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/request";
import { account } from "../features/accounts/api";
import type { Player } from "../features/accounts/api";
import AuthPage from "./AuthPage/AuthPage";
import LobbyPage from "./LobbyPage/LobbyPage";
import QuestionPage from "./QuestionPage/QuestionPage";
import RecruitPage from "./RecruitPage/RecruitPage";
import WorldPage from "./WorldPage/WorldPage";

type Session =
  | { kind: "restoring" }
  | { kind: "anonymous"; message: string; focus: boolean }
  | { kind: "authenticated"; player: Player; focus: boolean };
/** Keeps session restoration alive across StrictMode effect replay, without duplicate requests. */
export default function PlayerPortal() {
  const [session, setSession] = useState<Session>({ kind: "restoring" });
  const [page, setPage] = useState<
    "lobby" | "question" | "world" | "recruit"
  >("lobby");
  const restoration = useRef<Promise<Player> | null>(null);
  useEffect(() => {
    let active = true;
    restoration.current ??= account("me");
    restoration.current
      .then((player) => {
        if (active) setSession({ kind: "authenticated", player, focus: false });
      })
      .catch((error: unknown) => {
        if (active)
          setSession({
            kind: "anonymous",
            focus: false,
            message:
              error instanceof ApiError && error.status === 401
                ? ""
                : "The arena is taking a moment. You can try logging in below.",
          });
      });
    return () => {
      active = false;
    };
  }, []);
  if (session.kind !== "authenticated")
    return (
      <AuthPage
        restoring={session.kind === "restoring"}
        message={
          session.kind === "restoring"
            ? "Checking your player pass…"
            : session.message
        }
        focus={session.kind === "anonymous" && session.focus}
        onAuthenticated={(player) => {
          setPage("lobby");
          setSession({ kind: "authenticated", player, focus: true });
        }}
      />
    );
  const updateTokens = (tokens: number) =>
    setSession((current) =>
      current.kind === "authenticated"
        ? { ...current, player: { ...current.player, tokens } }
        : current,
    );
  if (page === "recruit")
    return (
      <RecruitPage
        tokens={session.player.tokens}
        onBack={() => {
          setPage("lobby");
          setSession({ ...session, focus: true });
        }}
        onTokens={updateTokens}
        onQuestion={() => setPage("question")}
      />
    );
  if (page === "world")
    return (
      <WorldPage
        onBack={() => {
          setPage("lobby");
          setSession((current) =>
            current.kind === "authenticated"
              ? { ...current, focus: true }
              : current,
          );
        }}
        onTokens={(tokens) =>
          setSession((current) =>
            current.kind === "authenticated"
              ? { ...current, player: { ...current.player, tokens } }
              : current,
          )
        }
      />
    );
  return page === "question" ? (
    <QuestionPage
      onBack={() => {
        setPage("lobby");
        setSession({ ...session, focus: true });
      }}
      onTokens={updateTokens}
    />
  ) : (
    <LobbyPage
      player={session.player}
      focus={session.focus}
      onQuestion={() => setPage("question")}
      onRecruit={() => setPage("recruit")}
      onExplore={() => setPage("world")}
      onLogout={() =>
        setSession({
          kind: "anonymous",
          message: "You’re logged out. See you next class.",
          focus: true,
        })
      }
    />
  );
}
