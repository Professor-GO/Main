/**
 * What each stickman looks like: the head pictures (seen from the front and from behind)
 * and the colours and line widths of the body. The heads are in Assets/stickman/heads, named
 * after the professor ids with underscores instead of hyphens; "main" is the player.
 */

/** A stickman's body. The far arm and leg are drawn in the darker colour, for depth. */
export type StickmanBody = {
  // The colour of the torso and the near limbs, and of the far limbs.
  near: string;
  far: string;
  shoes: string;
  // Line widths of the torso and the limbs, in the rig's own units.
  torso: number;
  limbs: number;
  // How long the feet are, and the radius of the hands (0 for no hands).
  foot: number;
  hand: number;
};

/** Everything needed to draw one stickman. A missing head picture is simply not drawn. */
export type StickmanLook = {
  front: string | undefined;
  back: string | undefined;
  body: StickmanBody;
};

const HEADS = import.meta.glob<string>(
  "../../../../Assets/stickman/heads/*.webp",
  { eager: true, query: "?url", import: "default" },
);

const body = (
  near: string,
  far: string,
  shoes: string,
  torso: number,
  limbs: number,
  foot: number,
  hand: number,
): StickmanBody => ({ near, far, shoes, torso, limbs, foot, hand });

const BODIES: Record<string, StickmanBody> = {
  main: body("#1c1c1c", "#4a4a4a", "#1c1c1c", 16, 14, 26, 6),
  "chao-liu": body("#e2e8f0", "#64748b", "#38bdf8", 16, 14, 26, 0),
  "craig-scratchley": body("#fde047", "#8a7a22", "#f97316", 14, 12, 30, 6),
  "frank-wood": body("#c084fc", "#6b4a8c", "#f0abfc", 18, 16, 24, 0),
  "guy-lumieux": body("#4ade80", "#2f7d4f", "#f8fafc", 15, 13, 28, 5),
  "michael-seica": body("#60a5fa", "#3b5f94", "#fbbf24", 16, 15, 22, 0),
  "shervin-jannesar": body("#f9a8d4", "#9d5a7e", "#e2e8f0", 17, 14, 32, 6),
  "tor-aamodt": body("#fb923c", "#9a5a2a", "#fef3c7", 13, 12, 26, 5),
};
const PLAIN_BODY = body("#cbd5e1", "#64748b", "#334155", 15, 13, 26, 0);

/**
 * Finds how to draw a stickman.
 * @param id - A professor's id, such as "chao-liu", or "main" for the player.
 * @returns Their head pictures and body. Someone without their own gets a plain grey body.
 */
export function lookFor(id: string): StickmanLook {
  const name = id.replaceAll("-", "_");
  const head = (side: string) =>
    HEADS[`../../../../Assets/stickman/heads/${name}_${side}.webp`];
  return {
    front: head("front"),
    back: head("back"),
    body: BODIES[id] ?? PLAIN_BODY,
  };
}
