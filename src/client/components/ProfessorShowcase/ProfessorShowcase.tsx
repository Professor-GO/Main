/** Preserves the fictional concept cards; these are not the persisted professor roster. */
import "./ProfessorShowcase.css";

/** Renders the original decorative artwork and recruitment concept copy. */
export default function ProfessorShowcase() {
  return (
    <section className="showcase" aria-labelledby="showcase-title">
      <div className="showcase-top">
        <span className="eyebrow">LESS LECTURE. MORE LEGEND.</span>
        <span className="edition">VOL. 001</span>
      </div>
      <div
        className="card-stage"
        aria-label="Illustrative professor cards: Dr. Vector and Prof. Byte"
      >
        <div className="orbit orbit-one" aria-hidden="true" />
        <div className="orbit orbit-two" aria-hidden="true" />
        <span className="stage-spark spark-one" aria-hidden="true">
          ✳
        </span>
        <span className="stage-spark spark-two" aria-hidden="true">
          +
        </span>
        <span className="stage-note" aria-hidden="true">
          KNOWLEDGE IS
          <br />A POWER MOVE.
        </span>
        <article className="prof-card vector-card">
          <div className="card-topline">
            <span>MATHEMATICS</span>
            <span>★ RARE</span>
          </div>
          <div className="prof-portrait vector-portrait">
            <span className="portrait-formula formula-one" aria-hidden="true">
              x² + y²
            </span>
            <span className="portrait-formula formula-two" aria-hidden="true">
              ∑
            </span>
            <svg
              viewBox="0 0 160 160"
              className="pixel-prof"
              role="img"
              aria-label="Pixel art of a professor in a sweater vest"
              shapeRendering="crispEdges"
            >
              <path
                d="M31 160v-38h12v-12h24V98h28v12h24v12h12v38"
                fill="#203d36"
              />
              <path d="M53 115h14l13 18 15-18h13v45H53Z" fill="#d4b365" />
              <path
                d="M64 109h13l3 16-13 7-10-17m39-6H83l-3 16 13 7 10-17"
                fill="#f6f1d5"
              />
              <path
                d="M47 42h66v46h-8v15H94v10H66v-10H55V87h-8Z"
                fill="#e4b98c"
              />
              <path
                d="M40 42V27h12V16h52v8h16v23h-13V35H92V25H60v18H47v16h-7Z"
                fill="#f6f1d5"
              />
              <path d="M44 57h8v18h-8m64-18h8v18h-8" fill="#e4b98c" />
              <path d="M50 50h26v22H50Zm35 0h26v22H85Z" fill="#203d36" />
              <path d="M56 56h14v10H56Zm35 0h14v10H91Z" fill="#c8ded1" />
              <path
                d="M76 56h9v6h-9M79 69h6v13h-6M69 90h22v5H69"
                fill="#203d36"
              />
              <path d="M61 138h9v5h-9m0 7h9v5h-9" fill="#a48648" />
              <path d="M111 126h26v34h-26Z" fill="#8ba683" />
              <path d="M111 126h7v34h-7Z" fill="#f6f1d5" />
            </svg>
            <span className="level-tag">LV. 01</span>
          </div>
          <div className="card-info">
            <h3>Dr. Vector</h3>
            <p>Always one step ahead.</p>
            <div className="card-move">
              <span>∑ &nbsp; Calculated strike</span>
              <strong>
                80 <small>ATK</small>
              </strong>
            </div>
          </div>
          <div className="card-bottom">
            <span>PROFESSOR-GO</span>
            <span>001 / MATH</span>
          </div>
        </article>
        <span className="versus" aria-hidden="true">
          VS<span>✦</span>
        </span>
        <article className="prof-card byte-card">
          <div className="card-topline">
            <span>COMPUTER SCIENCE</span>
            <span>✦ EPIC</span>
          </div>
          <div className="prof-portrait byte-portrait">
            <span className="portrait-formula formula-one" aria-hidden="true">
              &lt;/&gt;
            </span>
            <span className="portrait-formula formula-two" aria-hidden="true">
              {"{ }"}
            </span>
            <svg
              viewBox="0 0 160 160"
              className="pixel-prof"
              role="img"
              aria-label="Pixel art of a professor with glasses and a laptop"
              shapeRendering="crispEdges"
            >
              <path d="M47 28h12V16h43v10h15v88H43V47h4" fill="#253c3c" />
              <path
                d="M31 160v-38h13v-12h23V97h28v13h24v12h12v38"
                fill="#eee8d8"
              />
              <path d="M67 102h28v18H67Z" fill="#c48c69" />
              <path d="m67 114 13 12 15-12 13 8v38H54v-38Z" fill="#647c83" />
              <path d="M52 38h55v49H98v16H65V91H52Z" fill="#cd9b77" />
              <path
                d="M48 34h14V24h37v10h10v20H95V38H75v9H52v15h-8V40"
                fill="#253c3c"
              />
              <path d="M49 53h26v21H49Zm35 0h26v21H84Z" fill="#f4ead1" />
              <path d="M55 59h14v9H55Zm35 0h14v9H90Z" fill="#253c3c" />
              <path d="M75 58h9v5h-9M77 76h6v7h-6" fill="#f4ead1" />
              <path d="M72 91h18v5H72" fill="#253c3c" />
              <path d="M47 133h77v27H47Z" fill="#263f40" />
              <path d="M40 156h91v4H40Z" fill="#1a3031" />
              <path d="m77 143 7-4 7 4-7 5Z" fill="#d6ed8b" />
            </svg>
            <span className="level-tag">LV. 01</span>
          </div>
          <div className="card-info">
            <h3>Prof. Byte</h3>
            <p>It’s not a bug. It’s a move.</p>
            <div className="card-move">
              <span>&lt;/&gt; &nbsp; Stack overflow</span>
              <strong>
                95 <small>ATK</small>
              </strong>
            </div>
          </div>
          <div className="card-bottom">
            <span>PROFESSOR-GO</span>
            <span>002 / CPSC</span>
          </div>
        </article>
        <span className="sample-caption">
          CONCEPT CARDS · YOUR CAMPUS ROSTER IS NEXT
        </span>
      </div>
      <div className="showcase-copy">
        <p className="eyebrow">THE CAMPUS IS YOUR ARENA</p>
        <h2 id="showcase-title">Office hours are over.</h2>
        <p>
          Recruit the faculty. Find your favorites.
          <br />
          Take a little friendly rivalry to the next level.
        </p>
      </div>
      <div className="game-loop" id="how-it-works">
        <div>
          <span>01</span>
          <p>Spend tokens</p>
        </div>
        <span className="loop-arrow" aria-hidden="true">
          →
        </span>
        <div>
          <span>02</span>
          <p>Recruit profs</p>
        </div>
        <span className="loop-arrow" aria-hidden="true">
          →
        </span>
        <div>
          <span>03</span>
          <p>Battle it out</p>
        </div>
      </div>
    </section>
  );
}
