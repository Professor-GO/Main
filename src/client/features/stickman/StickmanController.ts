/**
 * Animates one StickmanRig. Adapted from Assets/stickman-react. It keeps track of what the
 * stickman is doing (standing, walking, swaying, attacking, or being hit), which way their
 * feet point, and the animation that is playing.
 */
import gsap from "gsap";
import * as animations from "./animations";
import type { PartName, RigParts } from "./StickmanRig";

// The point each part turns around, in the rig's own 400 × 600 space.
const PIVOTS: Partial<Record<PartName, string>> = {
  stickman: "200 320",
  upper: "200 320",
  head: "200 170",
  armLeft: "200 185",
  armRight: "200 185",
  forearmLeft: "200 255",
  forearmRight: "200 255",
  legLeft: "196 320",
  legRight: "204 320",
  shinLeft: "196 420",
  shinRight: "204 420",
};
const EXTRA_PIVOTS: Partial<Record<PartName, string>> = {
  flip: "200 320",
  headFace: "200 100",
  actor: "200 527",
};

/** What a stickman can be doing. */
export type StickmanState = "idle" | "walk" | "sway" | "attack" | "hit";

export class StickmanController {
  state: StickmanState = "idle";
  walkMode: "side" | "vert" | null = null;
  // 1 when the feet point right, -1 when they point left.
  direction = 1;
  private parts: RigParts;
  private timeline: gsap.core.Timeline | null = null;
  // What to go back to after an attack or a hit.
  private resting: "idle" | "sway" = "idle";

  /** @param parts - The rig's parts, from a drawn StickmanRig. */
  constructor(parts: RigParts) {
    this.parts = parts;
  }

  /** True while an attack or a hit is playing; other animations should wait for it. */
  get busy(): boolean {
    return this.state === "attack" || this.state === "hit";
  }

  private get joints() {
    return (Object.keys(PIVOTS) as PartName[]).map((name) => this.parts[name]);
  }

  /** Sets each part's pivot. Call once, after the rig is drawn. */
  setup(): this {
    for (const [name, origin] of Object.entries({
      ...PIVOTS,
      ...EXTRA_PIVOTS,
    })) {
      const part = this.parts[name as PartName];
      if (part) gsap.set(part, { svgOrigin: origin });
    }
    return this;
  }

  /** Turns the stickman to face right (1) or left (-1). The head picture is not mirrored. */
  setDirection(direction: number): void {
    if (direction === this.direction) return;
    this.direction = direction;
    gsap.set([this.parts.flip, this.parts.headFace], { scaleX: direction });
  }

  private enter(state: StickmanState): void {
    this.timeline?.kill();
    this.timeline = null;
    gsap.killTweensOf(this.joints);
    gsap.set(this.joints, { rotation: 0, x: 0, y: 0, scale: 1 });
    this.state = state;
  }

  /** Stands and breathes. */
  idle(): void {
    this.resting = "idle";
    this.enter("idle");
    this.timeline = animations.idle(this.parts);
  }

  /** Shakes left and right, ready to fight. */
  sway(): void {
    this.resting = "sway";
    this.enter("sway");
    this.timeline = animations.sway(this.parts);
  }

  /** Walks: "side" for left or right, "vert" for towards or away from the viewer. */
  walk(mode: "side" | "vert"): void {
    if (this.state === "walk" && this.walkMode === mode) return;
    this.enter("walk");
    this.walkMode = mode;
    this.timeline = animations.walk(this.parts, mode);
  }

  /** Punches, then goes back to standing or swaying. `onPunch` is called as the punch lands. */
  attack(onPunch?: () => void): void {
    this.enter("attack");
    this.timeline = animations.attack(this.parts, {
      side: this.direction,
      onPunch,
      onDone: () => this[this.resting](),
    });
  }

  /** Reels from a hit, then goes back to standing or swaying. */
  hit(): void {
    this.enter("hit");
    this.timeline = animations.hit(this.parts, {
      onDone: () => this[this.resting](),
    });
  }

  /** Stops every animation. Call when the rig is removed. */
  destroy(): void {
    this.timeline?.kill();
    gsap.killTweensOf(this.joints);
  }
}
