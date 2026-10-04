/** Owns the public header, footer, native help dialog and two-column portal layout. */
import { useRef } from "react";
import type { MouseEvent, ReactNode } from "react";

import ProfessorShowcase from "../ProfessorShowcase/ProfessorShowcase";
import "./SiteShell.css";

type SiteShellProps = { children: ReactNode };

/** Preserves native dialog focus, Escape dismissal and backdrop interaction. */
export default function SiteShell({ children }: SiteShellProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  /** Opens the native modal so the browser owns focus containment. */
  function openDialog() {
    dialog.current?.showModal();
  }
  /** Closes the modal and lets the browser restore opener focus. */
  function closeDialog() {
    dialog.current?.close();
  }
  /** Matches the original dialog-target click dismissal. */
  function dismissBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) closeDialog();
  }

  return (
    <>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Professor-Go home">
          <svg className="brand-mark" viewBox="0 0 40 44" aria-hidden="true">
            <path d="M2 2h36v25L20 42 2 27Z" fill="currentColor" />
            <path d="m9 16 11-6 11 6-11 6Z" fill="#d6ed8b" />
            <path d="M13 21v7l7 4 7-4v-7l-7 4Z" fill="#d6ed8b" />
          </svg>
          <span>
            PROFESSOR
            <span className="brand-second">
              -GO<span className="brand-dot">.</span>
            </span>
          </span>
        </a>
        <div className="header-right">
          <button
            className="text-button"
            id="how-to-play"
            type="button"
            onClick={openDialog}
          >
            How it works <span aria-hidden="true">↗</span>
          </button>
          <span className="version-badge">
            <span className="status-dot" /> EARLY ACCESS
          </span>
        </div>
      </header>
      <main className="main-grid">
        <section className="auth-section" aria-label="Player portal">
          {children}
        </section>
        <ProfessorShowcase />
      </main>
      <footer className="site-footer">
        <span>Built on campus. Settled in the arena.</span>
        <span className="footer-meta">
          <span className="status-dot" /> A STUDENT HACKATHON PROJECT{" "}
          <span className="footer-star" aria-hidden="true">
            ✳
          </span>
        </span>
      </footer>
      <dialog
        ref={dialog}
        id="how-dialog"
        aria-labelledby="how-title"
        onClick={dismissBackdrop}
      >
        <button
          id="close-dialog"
          className="dialog-close"
          type="button"
          aria-label="Close how it works"
          onClick={closeDialog}
        >
          ×
        </button>
        <p className="eyebrow">A DIFFERENT KIND OF CLASS SCHEDULE</p>
        <h2 id="how-title">Meet your new campus rivalry.</h2>
        <ol className="how-list">
          <li>
            <strong>Get your player pass.</strong>
            <p>
              Create an account and claim your username. That part is ready to
              go.
            </p>
          </li>
          <li>
            <strong>Recruit your professors.</strong>
            <p>
              The plan: spend tokens in a gacha draw to recruit professors from
              your university.
            </p>
          </li>
          <li>
            <strong>Build a team. Battle it out.</strong>
            <p>
              Mix your favorites and challenge other teams. Recruiting and
              battles are coming in a future update.
            </p>
          </li>
        </ol>
        <p className="dialog-note">
          The illustrated professors are fictional concept cards. Your
          university’s roster will come later.
        </p>
      </dialog>
    </>
  );
}
