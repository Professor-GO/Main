import type { RefObject } from "react";
import type { StickmanBody } from "./looks";

/** The names of the rig's movable parts, which the animations turn and shift. */
export type PartName =
  | "actor"
  | "stickman"
  | "flip"
  | "upper"
  | "head"
  | "headFace"
  | "armLeft"
  | "armRight"
  | "forearmLeft"
  | "forearmRight"
  | "legLeft"
  | "legRight"
  | "shinLeft"
  | "shinRight";
/** The rig's parts once drawn, by name. */
export type RigParts = Partial<Record<PartName, SVGGElement | null>>;

// The head picture's box: 140 units tall with the chin resting on the neck, and wide enough
// for the widest head. The picture keeps its shape and is centred at the bottom of the box.
const HEAD = { x: 100, y: 32, width: 200, height: 140 };

/**
 * The drawing of a jointed stickman, as an SVG group in its own 400 × 600 space with the feet
 * at (200, 527). Put it inside any <svg>. Adapted from Assets/stickman-react.
 * The parts nest as: actor > stickman > flip > legs + upper (arms, torso, head).
 */
export default function StickmanRig({
  parts,
  body,
  head,
}: {
  // Receives each movable part once it is drawn, for a StickmanController to animate.
  parts: RefObject<RigParts>;
  body: StickmanBody;
  // The head picture's URL, or undefined for no head.
  head: string | undefined;
}) {
  const part = (name: PartName) => (element: SVGGElement | null) => {
    parts.current[name] = element;
  };
  const arm = (side: "Left" | "Right", colour: string) => (
    <g ref={part(`arm${side}`)} stroke={colour} strokeWidth={body.limbs - 2}>
      <line x1="200" y1="185" x2="200" y2="255" />
      <g ref={part(`forearm${side}`)} strokeWidth={body.limbs - 4}>
        <line x1="200" y1="255" x2="206" y2="320" />
        <circle cx="206" cy="320" r={body.hand} fill={colour} stroke="none" />
      </g>
    </g>
  );
  const leg = (side: "Left" | "Right", hipX: number, colour: string) => (
    <g ref={part(`leg${side}`)} stroke={colour} strokeWidth={body.limbs}>
      <line x1={hipX} y1="320" x2={hipX} y2="420" />
      <g ref={part(`shin${side}`)} strokeWidth={body.limbs - 2}>
        <line x1={hipX} y1="420" x2={hipX} y2="520" />
        <line
          x1={hipX}
          y1="520"
          x2={hipX + body.foot}
          y2="520"
          stroke={body.shoes}
        />
      </g>
    </g>
  );
  return (
    <g ref={part("actor")}>
      <g ref={part("stickman")} fill="none" strokeLinecap="round">
        <ellipse
          cx="200"
          cy="527"
          rx="60"
          ry="7"
          fill="rgb(0 0 0 / 0.35)"
          stroke="none"
        />
        <g ref={part("flip")}>
          {leg("Left", 196, body.far)}
          {leg("Right", 204, body.near)}
          <g ref={part("upper")}>
            {arm("Left", body.far)}
            <line
              x1="200"
              y1="170"
              x2="200"
              y2="320"
              stroke={body.near}
              strokeWidth={body.torso}
            />
            {arm("Right", body.near)}
            <g ref={part("head")}>
              <g ref={part("headFace")}>
                {head && (
                  <image
                    href={head}
                    {...HEAD}
                    preserveAspectRatio="xMidYMax meet"
                  />
                )}
              </g>
            </g>
          </g>
        </g>
      </g>
    </g>
  );
}
