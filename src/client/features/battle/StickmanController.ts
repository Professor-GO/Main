import { gsap } from "gsap";
import { PIVOTS } from "./rig";
import type { Joint, RigParts } from "./rig";

type Pose = {
  rotation: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
};
const neutral = (): Pose => ({
  rotation: 0,
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
});
type Motion = "idle" | "attack" | "hit" | "heal" | "wave" | "walk" | "defeated";

/** GSAP motions adapted from the supplied rig. Local SVG transforms keep pivots correct for both scaled actors. */
export class StickmanController {
  private poses = Object.fromEntries(
    Object.keys(PIVOTS).map((key) => [key, neutral()]),
  ) as Record<Joint, Pose>;
  private timeline: gsap.core.Timeline | null = null;
  private destroyed = false;
  private reduced = false;
  private side: 1 | -1;
  constructor(
    private parts: RigParts,
    side: 1 | -1,
    private root: SVGGElement,
  ) {
    this.side = side;
  }

  /** Writes each transform around its original local joint, counter-mirroring the portrait. */
  private render = () => {
    for (const key of Object.keys(PIVOTS) as Joint[]) {
      const p = this.poses[key],
        [x, y] = PIVOTS[key];
      this.parts[key]?.setAttribute(
        "transform",
        `translate(${p.x} ${p.y}) translate(${x} ${y}) rotate(${p.rotation}) scale(${p.scaleX} ${p.scaleY}) translate(${-x} ${-y})`,
      );
      this.parts[key]?.setAttribute("opacity", String(p.opacity));
    }
  };

  /** Stops the old timeline before entering another motion; completion callbacks cannot survive cleanup. */
  private enter(motion: Motion): void {
    this.timeline?.kill();
    this.timeline = null;
    for (const key of Object.keys(PIVOTS) as Joint[])
      Object.assign(this.poses[key], neutral());
    this.poses.flip.scaleX = this.side;
    this.poses.headFace.scaleX = this.side;
    this.root.dataset.motion = motion;
    this.render();
  }
  /** Builds a tracked timeline; every tick updates the rig without triggering React renders. */
  private animate(onComplete?: () => void) {
    const timeline = gsap.timeline({
      onUpdate: this.render,
      onComplete: () => {
        if (!this.destroyed) onComplete?.();
      },
    });
    this.timeline = timeline;
    return timeline;
  }
  /** Changes accessibility motion preferences immediately, cancelling in-flight movements. */
  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    this.idle();
  }
  /** Original gentle breathing and arm sway, suspended for reduced motion. */
  idle(): void {
    if (this.destroyed) return;
    this.enter("idle");
    // Separate overlapping limbs so the original side-on rig reads at a smaller battle scale.
    this.poses.armLeft.rotation = 16;
    this.poses.armRight.rotation = -16;
    this.poses.forearmLeft.rotation = -12;
    this.poses.forearmRight.rotation = -12;
    this.poses.legLeft.rotation = 5;
    this.poses.legRight.rotation = -5;
    this.render();
    if (this.reduced) return;
    this.animate()
      .repeat(-1)
      .yoyo(true)
      .to(this.poses.upper, { rotation: 2, duration: 2, ease: "sine.inOut" }, 0)
      .to(this.poses.head, { rotation: -1.5, y: 2, duration: 2 }, 0)
      .to(this.poses.armLeft, { rotation: 19, duration: 2 }, 0)
      .to(this.poses.armRight, { rotation: -19, duration: 2 }, 0);
  }
  /** Wind up, lunge, punch, and return. Hit reactions are synchronized to confirmed damage at impact. */
  attack(onPunch: () => void, onDone: () => void): void {
    this.enter("attack");
    if (this.reduced) {
      onPunch();
      this.idle();
      onDone();
      return;
    }
    this.animate(() => {
      this.idle();
      onDone();
    })
      .to(
        this.poses.actor,
        { x: this.side * 480, duration: 0.3, ease: "power2.out" },
        0,
      )
      .to(
        this.poses.upper,
        { rotation: -10, duration: 0.3, ease: "power1.in" },
        0,
      )
      .to(this.poses.armRight, { rotation: 80, duration: 0.3 }, 0)
      .to(this.poses.forearmRight, { rotation: -90, duration: 0.3 }, 0)
      .to(this.poses.legRight, { rotation: 10, duration: 0.3 }, 0)
      .to(this.poses.legLeft, { rotation: -12, duration: 0.3 }, 0)
      .to(
        this.poses.upper,
        { rotation: 15, duration: 0.1, ease: "power4.out" },
        0.3,
      )
      .to(
        this.poses.armRight,
        { rotation: -90, duration: 0.1, ease: "power4.out" },
        0.3,
      )
      .to(this.poses.forearmRight, { rotation: 0, duration: 0.1 }, 0.3)
      .call(onPunch, [], 0.36)
      .to(
        Object.values(this.poses).filter(
          (p) => p !== this.poses.flip && p !== this.poses.headFace,
        ),
        { rotation: 0, x: 0, y: 0, duration: 0.3, ease: "power2.out" },
        0.5,
      );
  }
  /** Original stagger and recovery, with recoil pointing away from the opposing fighter. */
  hit(onDone: () => void = () => {}): void {
    this.enter("hit");
    if (this.reduced) {
      this.idle();
      onDone();
      return;
    }
    this.animate(() => {
      this.idle();
      onDone();
    })
      .to(
        this.poses.stickman,
        { x: -this.side * 30, duration: 0.1, ease: "power4.out" },
        0,
      )
      .to(this.poses.upper, { rotation: -25, duration: 0.1 }, 0)
      .to(this.poses.head, { rotation: -25, y: -4, duration: 0.1 }, 0)
      .to(this.poses.armLeft, { rotation: 50, duration: 0.1 }, 0)
      .to(this.poses.armRight, { rotation: -50, duration: 0.1 }, 0)
      .to(this.poses.legLeft, { rotation: 15, duration: 0.1 }, 0)
      .to(this.poses.shinLeft, { rotation: 30, duration: 0.1 }, 0)
      .to(this.poses.legRight, { rotation: -10, duration: 0.1 }, 0)
      .to(this.poses.shinRight, { rotation: 20, duration: 0.1 }, 0)
      .to(
        [
          this.poses.stickman,
          this.poses.upper,
          this.poses.head,
          this.poses.armLeft,
          this.poses.armRight,
          this.poses.legLeft,
          this.poses.legRight,
          this.poses.shinLeft,
          this.poses.shinRight,
        ],
        { rotation: 0, x: 0, y: 0, duration: 0.35, ease: "back.out(1.2)" },
        0.25,
      );
  }
  /** Adds a visible recovery beat for quiz healing. HP remains entirely server-owned. */
  heal(onDone: () => void): void {
    this.enter("heal");
    if (this.reduced) {
      this.idle();
      onDone();
      return;
    }
    this.animate(() => {
      this.idle();
      onDone();
    }).to(this.poses.upper, {
      y: -12,
      duration: 0.2,
      repeat: 1,
      yoyo: true,
      ease: "sine.inOut",
    });
  }
  /** Archive wave, adapted into a victory pose. */
  wave(): void {
    this.enter("wave");
    this.poses.armRight.rotation = -150;
    this.poses.forearmRight.rotation = -25;
    this.render();
    if (!this.reduced)
      this.animate().repeat(-1).yoyo(true).to(this.poses.forearmRight, {
        rotation: 25,
        duration: 0.35,
        ease: "sine.inOut",
      });
  }
  /** Uses the archive's walking stride to leave the encounter. */
  flee(onDone: () => void): void {
    this.enter("walk");
    this.poses.flip.scaleX = -this.side;
    this.poses.headFace.scaleX = -this.side;
    this.render();
    if (this.reduced) {
      this.poses.actor.opacity = 0.2;
      this.render();
      onDone();
      return;
    }
    this.animate(onDone)
      .to(
        this.poses.legLeft,
        { rotation: 30, duration: 0.15, repeat: 3, yoyo: true },
        0,
      )
      .to(
        this.poses.legRight,
        { rotation: -30, duration: 0.15, repeat: 3, yoyo: true },
        0,
      )
      .to(
        this.poses.armLeft,
        { rotation: -30, duration: 0.15, repeat: 3, yoyo: true },
        0,
      )
      .to(
        this.poses.armRight,
        { rotation: 30, duration: 0.15, repeat: 3, yoyo: true },
        0,
      )
      .to(
        this.poses.actor,
        { x: -this.side * 400, opacity: 0.1, duration: 0.6, ease: "power1.in" },
        0,
      );
  }
  /** Keeps a defeated actor down instead of the archive demo's automatic HP reset/respawn. */
  defeated(): void {
    this.enter("defeated");
    if (this.reduced) {
      this.poses.actor.opacity = 0.45;
      this.render();
      return;
    }
    this.animate().to(this.poses.actor, {
      rotation: -this.side * 80,
      opacity: 0.5,
      duration: 0.4,
      ease: "power2.out",
    });
  }
  /** Kills all owned timelines before React removes the SVG nodes. */
  destroy(): void {
    this.destroyed = true;
    this.timeline?.kill();
    this.timeline = null;
  }
}
