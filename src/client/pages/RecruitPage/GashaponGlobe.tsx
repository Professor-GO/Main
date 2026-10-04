/** Draws the capsules tumbling in the gashapon globe, laid over the machine picture. */
import { useEffect, useRef } from "react";
import { CAPSULE_ART } from "../../features/recruitment/art";
import {
  CAPSULE_RADIUS,
  createCapsules,
  shake,
  stepCapsules,
} from "../../features/recruitment/capsules";
import type { CapsuleColor } from "../../features/recruitment/capsules";

// How many capsules fill the globe, and how often a shake throws them while the machine runs.
const CAPSULE_COUNT = 16;
const SHAKE_EVERY = 0.28;
// The globe picture's glass, as a share of the canvas: the circle the capsules stay in, and
// the top edge hidden under the machine's lid.
const GLASS = 0.95;
const LID = 0.17;

type GashaponGlobeProps = { shaking: boolean; still: boolean };

/**
 * @param shaking - True while the machine is shaking, which throws the capsules around.
 * @param still - True when the player prefers reduced motion; the capsules then stay at rest.
 */
export default function GashaponGlobe({ shaking, still }: GashaponGlobeProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shakingRef = useRef(false);
  useEffect(() => {
    shakingRef.current = shaking && !still;
  }, [shaking, still]);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const capsules = createCapsules(CAPSULE_COUNT);
    // Let the capsules settle before the first frame.
    stepCapsules(capsules, 2);
    const images = new Map<CapsuleColor, HTMLImageElement>();
    for (const [color, url] of Object.entries(CAPSULE_ART)) {
      const image = new Image();
      image.src = url;
      images.set(color as CapsuleColor, image);
    }
    let frame = 0;
    let last = performance.now();
    let sinceShake = SHAKE_EVERY;
    const draw = (now: number) => {
      const seconds = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (shakingRef.current) {
        sinceShake += seconds;
        if (sinceShake >= SHAKE_EVERY) {
          shake(capsules);
          sinceShake = 0;
        }
      } else sinceShake = SHAKE_EVERY;
      stepCapsules(capsules, seconds);
      const size = Math.round(
        element.clientWidth * Math.min(2, window.devicePixelRatio || 1),
      );
      if (size > 0 && element.width !== size) {
        element.width = size;
        element.height = size;
      }
      const half = element.width / 2;
      const scale = half * GLASS;
      context.clearRect(0, 0, element.width, element.height);
      context.save();
      context.beginPath();
      context.arc(half, half, scale, 0, Math.PI * 2);
      context.clip();
      context.beginPath();
      context.rect(0, element.height * LID, element.width, element.height);
      context.clip();
      const radius = CAPSULE_RADIUS * scale;
      for (const capsule of capsules) {
        const image = images.get(capsule.color);
        if (!image?.complete || !image.naturalWidth) continue;
        context.save();
        context.translate(half + capsule.x * scale, half + capsule.y * scale);
        context.rotate(capsule.angle);
        context.drawImage(image, -radius, -radius, radius * 2, radius * 2);
        context.restore();
      }
      context.restore();
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={canvas} className="gacha-globe" aria-hidden="true" />;
}
