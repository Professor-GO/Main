import type { MutableRefObject } from "react";
import { headProps } from "./rig";
import type { FighterArt, Joint, RigParts } from "./rig";

/** Articulated SVG markup adapted from the archive; the same rig is used for both combatants. */
export default function StickmanRig({
  parts,
  fighter,
}: {
  parts: MutableRefObject<RigParts>;
  fighter: FighterArt;
}) {
  const b = fighter.body;
  const joint = (key: Joint) => (element: SVGGElement | null) => {
    parts.current[key] = element;
  };
  const arm = (side: "Left" | "Right", color: string) => (
    <g ref={joint(`arm${side}`)} stroke={color} strokeWidth={b.l - 2}>
      <line x1="200" y1="185" x2="200" y2="255" />
      <g ref={joint(`forearm${side}`)} strokeWidth={b.l - 4}>
        <line x1="200" y1="255" x2="206" y2="320" />
        <circle cx="206" cy="320" r={b.h} fill={color} stroke="none" />
      </g>
    </g>
  );
  const leg = (side: "Left" | "Right", x: number, color: string) => (
    <g ref={joint(`leg${side}`)} stroke={color} strokeWidth={b.l}>
      <line x1={x} y1="320" x2={x} y2="420" />
      <g ref={joint(`shin${side}`)} strokeWidth={b.l - 2}>
        <line x1={x} y1="420" x2={x} y2="520" />
        <line x1={x} y1="520" x2={x + b.f} y2="520" stroke={b.s} />
      </g>
    </g>
  );
  return (
    <g ref={joint("actor")}>
      <g ref={joint("stickman")} fill="none" strokeLinecap="round">
        <ellipse cx="200" cy="527" rx="60" ry="7" fill="#0005" stroke="none" />
        <g ref={joint("flip")}>
          {leg("Left", 196, b.d)}
          {leg("Right", 204, b.c)}
          <g ref={joint("upper")}>
            {arm("Left", b.d)}
            <line
              x1="200"
              y1="170"
              x2="200"
              y2="320"
              stroke={b.c}
              strokeWidth={b.t}
            />
            {arm("Right", b.c)}
            <g ref={joint("head")}>
              <g ref={joint("headFace")}>
                {fighter.front ? (
                  <image
                    {...headProps(fighter.front)}
                    preserveAspectRatio="xMidYMax meet"
                  />
                ) : (
                  <>
                    <circle
                      cx="200"
                      cy="113"
                      r="52"
                      fill="#f1d1a5"
                      stroke="#294536"
                      strokeWidth="5"
                    />
                    <path
                      d="M153 106 Q158 44 214 57 Q248 66 250 105"
                      fill="#294536"
                    />
                    <circle cx="184" cy="113" r="4" fill="#294536" />
                    <circle cx="216" cy="113" r="4" fill="#294536" />
                    <path
                      d="M184 137 Q200 147 216 137"
                      stroke="#294536"
                      strokeWidth="4"
                    />
                  </>
                )}
              </g>
            </g>
          </g>
        </g>
      </g>
    </g>
  );
}
