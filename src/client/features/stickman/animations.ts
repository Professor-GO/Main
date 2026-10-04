/**
 * The stickman's animations, adapted from Assets/stickman-react. Each one takes the rig's
 * parts and returns a GSAP timeline. Rotations are in degrees: a positive angle turns a limb
 * clockwise (swinging back), a negative one swings it forward. The body faces right.
 */
import gsap from "gsap";
import type { RigParts } from "./StickmanRig";

const EASE = "sine.inOut";
// Every part an animation turns or shifts, for putting them all back at rest.
const joints = (parts: RigParts) => [
  parts.stickman,
  parts.upper,
  parts.head,
  parts.armLeft,
  parts.armRight,
  parts.forearmLeft,
  parts.forearmRight,
  parts.legLeft,
  parts.legRight,
  parts.shinLeft,
  parts.shinRight,
];

/**
 * Breathing in place: a slow sway of the upper body, head, and arms. The arms and legs are
 * held a little apart, so the stickman reads as a person and not a pole when standing still.
 */
export const idle = (parts: RigParts) =>
  gsap
    .timeline({
      repeat: -1,
      yoyo: true,
      defaults: { duration: 2, ease: EASE },
    })
    .set(parts.legLeft!, { rotation: 7 }, 0)
    .set(parts.legRight!, { rotation: -7 }, 0)
    .to(parts.upper!, { rotation: 2 }, 0)
    .to(parts.head!, { rotation: -1.5, y: 2 }, 0)
    .fromTo(parts.armLeft!, { rotation: 12 }, { rotation: 16 }, 0)
    .fromTo(parts.armRight!, { rotation: -12 }, { rotation: -16 }, 0);

/** Ready to fight: the whole body shakes left and right, with the fists up a little. */
export const sway = (parts: RigParts) =>
  gsap
    .timeline({ repeat: -1, yoyo: true, defaults: { ease: EASE } })
    .fromTo(parts.stickman!, { x: -14 }, { x: 14, duration: 0.45 }, 0)
    .fromTo(parts.upper!, { rotation: -4 }, { rotation: 4, duration: 0.45 }, 0)
    .fromTo(
      parts.armRight!,
      { rotation: -35 },
      { rotation: -25, duration: 0.45 },
      0,
    )
    .fromTo(
      parts.forearmRight!,
      { rotation: -70 },
      { rotation: -60, duration: 0.45 },
      0,
    )
    .fromTo(
      parts.armLeft!,
      { rotation: -20 },
      { rotation: -12, duration: 0.45 },
      0,
    )
    .fromTo(
      parts.forearmLeft!,
      { rotation: -70 },
      { rotation: -60, duration: 0.45 },
      0,
    );

/**
 * Walking. "side" is a full stride for walking left or right; "vert" is small steps for
 * walking towards or away from the viewer.
 */
export function walk(parts: RigParts, mode: "side" | "vert") {
  const side = mode === "side";
  const time = side ? 0.4 : 0.35;
  const timeline = gsap.timeline({ repeat: -1, yoyo: true });
  const swing = (
    part: SVGGElement | null | undefined,
    from: number,
    to: number,
  ) =>
    timeline.fromTo(
      part!,
      { rotation: from },
      { rotation: to, duration: time, ease: EASE },
      0,
    );
  if (side) {
    swing(parts.legLeft, 30, -30);
    swing(parts.legRight, -30, 30);
    swing(parts.shinLeft, 50, 5);
    swing(parts.shinRight, 5, 50);
    swing(parts.armLeft, -30, 30);
    swing(parts.armRight, 30, -30);
    swing(parts.forearmLeft, -10, -40);
    swing(parts.forearmRight, -40, -10);
    swing(parts.upper, 2, 4);
  } else {
    swing(parts.legLeft, 8, -8);
    swing(parts.legRight, -8, 8);
    swing(parts.shinLeft, 25, 0);
    swing(parts.shinRight, 0, 25);
    swing(parts.armLeft, -10, 10);
    swing(parts.armRight, 10, -10);
  }
  timeline.fromTo(
    parts.stickman!,
    { y: 0 },
    {
      y: side ? -8 : -6,
      duration: time / 2,
      ease: EASE,
      repeat: 1,
      yoyo: true,
    },
    0,
  );
  return timeline;
}

/**
 * A punch: wind up, strike, and recover.
 * @param options.side - 1 to punch to the right, -1 to the left.
 * @param options.onPunch - Called at the moment the punch lands.
 * @param options.onDone - Called when the stickman is back at rest.
 */
export function attack(
  parts: RigParts,
  options: { side: number; onPunch?: () => void; onDone?: () => void },
) {
  return gsap
    .timeline()
    .to(parts.upper!, { rotation: -10, duration: 0.3, ease: "power1.in" }, 0)
    .to(parts.armRight!, { rotation: 80, duration: 0.3, ease: "power1.in" }, 0)
    .to(
      parts.forearmRight!,
      { rotation: -90, duration: 0.3, ease: "power1.in" },
      0,
    )
    .to(parts.legRight!, { rotation: 10, duration: 0.3 }, 0)
    .to(parts.legLeft!, { rotation: -12, duration: 0.3 }, 0)
    .to(parts.upper!, { rotation: 15, duration: 0.1, ease: "power4.out" }, 0.3)
    .to(parts.stickman!, { x: 60, duration: 0.1, ease: "power4.out" }, 0.3)
    .to(
      parts.armRight!,
      { rotation: -90, duration: 0.1, ease: "power4.out" },
      0.3,
    )
    .to(
      parts.forearmRight!,
      { rotation: 0, duration: 0.1, ease: "power4.out" },
      0.3,
    )
    .to(parts.legRight!, { rotation: -15, duration: 0.1 }, 0.3)
    .call(() => options.onPunch?.(), [], 0.36)
    .to({}, { duration: 0.15 })
    .to(joints(parts), {
      rotation: 0,
      x: 0,
      y: 0,
      duration: 0.4,
      ease: "power2.out",
    })
    .call(() => options.onDone?.());
}

/**
 * Being hit: the body is knocked back and springs upright again.
 * @param options.onDone - Called when the stickman is back at rest.
 */
export function hit(parts: RigParts, options: { onDone?: () => void }) {
  const time = 0.1;
  return gsap
    .timeline()
    .to(parts.stickman!, { x: -30, duration: time, ease: "power4.out" }, 0)
    .to(parts.upper!, { rotation: -25, duration: time, ease: "power4.out" }, 0)
    .to(parts.head!, { rotation: -25, y: -4, duration: time }, 0)
    .to(parts.armLeft!, { rotation: 50, duration: time }, 0)
    .to(parts.forearmLeft!, { rotation: -30, duration: time }, 0)
    .to(parts.armRight!, { rotation: -50, duration: time }, 0)
    .to(parts.forearmRight!, { rotation: -40, duration: time }, 0)
    .to(parts.legLeft!, { rotation: 15, duration: time }, 0)
    .to(parts.shinLeft!, { rotation: 30, duration: time }, 0)
    .to(parts.legRight!, { rotation: -10, duration: time }, 0)
    .to(parts.shinRight!, { rotation: 20, duration: time }, 0)
    .to(joints(parts), {
      rotation: 0,
      x: 0,
      y: 0,
      duration: 0.6,
      delay: 0.2,
      ease: "back.out(1.2)",
    })
    .call(() => options.onDone?.());
}
