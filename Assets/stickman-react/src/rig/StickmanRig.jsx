import { headProps } from "./head.js";

/**
 * Pure markup of the articulated stickman (a <g>, 400x600 local space, feet at 200,527).
 * Drop it inside any <svg>. `parts` is a ref object that receives every joint element.
 *   actor > stickman > flip > legs + upper(arms, torso, head)
 */
export default function StickmanRig({ parts, body: b, head }) {
  const r = (k) => (el) => { parts.current[k] = el; };
  const arm = (side, color) => (
    <g ref={r("arm" + side)} stroke={color} strokeWidth={b.l - 2}>
      <line x1="200" y1="185" x2="200" y2="255" />
      <g ref={r("forearm" + side)} strokeWidth={b.l - 4}>
        <line x1="200" y1="255" x2="206" y2="320" />
        <circle cx="206" cy="320" r={b.h} fill={color} stroke="none" />
      </g>
    </g>
  );
  const leg = (side, hx, color) => (
    <g ref={r("leg" + side)} stroke={color} strokeWidth={b.l}>
      <line x1={hx} y1="320" x2={hx} y2="420" />
      <g ref={r("shin" + side)} strokeWidth={b.l - 2}>
        <line x1={hx} y1="420" x2={hx} y2="520" />
        <line x1={hx} y1="520" x2={hx + b.f} y2="520" stroke={b.s} />
      </g>
    </g>
  );
  return (
    <g ref={r("actor")}>
      <g ref={r("stickman")} fill="none" strokeLinecap="round">
        <ellipse cx="200" cy="527" rx="60" ry="7" fill="rgba(0,0,0,.5)" stroke="none" />
        <g ref={r("flip")}>
          {leg("Left", 196, b.d)}
          {leg("Right", 204, b.c)}
          <g ref={r("upper")}>
            {arm("Left", b.d)}
            <line x1="200" y1="170" x2="200" y2="320" stroke={b.c} strokeWidth={b.t} />
            {arm("Right", b.c)}
            <g ref={r("head")}>
              <g ref={r("headFace")}><image {...headProps(head)} preserveAspectRatio="xMidYMax meet" /></g>
            </g>
          </g>
        </g>
      </g>
    </g>
  );
}
