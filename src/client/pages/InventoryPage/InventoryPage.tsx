import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/request";
import { loadInventory } from "../../features/recruitment/inventory";
import type { OwnedProfessor } from "../../features/recruitment/inventory";
import { professorArt } from "../../features/recruitment/art";
import "./InventoryPage.css";

export default function InventoryPage({
  onBack,
  onRecruit,
}: {
  onBack: () => void;
  onRecruit: () => void;
}) {
  const [professors, setProfessors] = useState<OwnedProfessor[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = "Your professors · Professor-Go";
    title.current?.focus();
  }, []);
  useEffect(() => {
    let active = true;
    setError("");
    setProfessors(null);
    loadInventory()
      .then((items) => {
        if (active) setProfessors(items);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return (
    <section className="inventory-page" aria-labelledby="inventory-title">
      <button type="button" className="secondary-button" onClick={onBack}>
        ← Back to lobby
      </button>
      <p className="eyebrow">YOUR FACULTY</p>
      <h1 id="inventory-title" ref={title} tabIndex={-1}>
        Your professors<span className="accent-dot">.</span>
      </h1>
      <p className="intro">
        Choose from this collection when you enter a battle. Each professor can
        fight once per encounter.
      </p>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      ) : professors === null ? (
        <p role="status">Loading your professors…</p>
      ) : professors.length === 0 ? (
        <div className="inventory-empty">
          <h2>No professors yet</h2>
          <p>
            Recruit your first professor to start building your battle roster.
          </p>
          <button className="primary-button" type="button" onClick={onRecruit}>
            Recruit a professor →
          </button>
        </div>
      ) : (
        <>
          <p>
            {professors.length}{" "}
            {professors.length === 1 ? "professor" : "professors"} collected ·
            Duplicate copies are saved for upgrades.
          </p>
          <div className="inventory-grid">
            {professors.map((professor) => (
              <article key={professor.id} className="inventory-card">
                {professorArt(professor.id) ? (
                  <img src={professorArt(professor.id)!} alt="" />
                ) : (
                  <span
                    className="inventory-portrait-placeholder"
                    aria-hidden="true"
                  >
                    ✦
                  </span>
                )}
                <p className="eyebrow">
                  {professor.rarity} · Lv. {professor.level}
                </p>
                <h2>{professor.name}</h2>
                <p>{professor.department}</p>
                <dl>
                  {Object.entries(professor.stats).map(([stat, value]) => (
                    <div key={stat}>
                      <dt>{stat === "health" ? "HP" : stat}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <p>
                  {professor.copies}{" "}
                  {professor.copies === 1 ? "copy" : "copies"} owned
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
