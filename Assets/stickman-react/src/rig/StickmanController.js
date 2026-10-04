import gsap from "gsap";
import { PIVOTS, EXTRA_PIVOTS } from "./pivots.js";
import * as A from "./animations.js";

/**
 * Drives one StickmanRig. Plain class (no React): owns the state machine
 * (idle | walk | wave | attack | hit), the foot direction and the active timeline.
 */
export class StickmanController {
  constructor(parts) {
    this.p = parts;
    this.state = "idle";
    this.walkMode = null;
    this.dir = 1;          // 1: feet point right, -1: left
    this.tl = null;
    this.onState = null;   // (state) => void
  }

  get busy() { return this.state === "attack" || this.state === "hit"; }
  get joints() { return Object.keys(PIVOTS).map((k) => this.p[k]); }

  setup() {
    for (const [k, o] of Object.entries({ ...PIVOTS, ...EXTRA_PIVOTS })) gsap.set(this.p[k], { svgOrigin: o });
    return this;
  }

  setDir(d) {
    this.dir = d;
    gsap.set([this.p.flip, this.p.headFace], { scaleX: d });   // head portrait is counter-mirrored
  }

  reset() {
    this.tl?.kill(); this.tl = null;
    gsap.killTweensOf(this.joints);
    gsap.set(this.joints, { rotation: 0, x: 0, y: 0, scale: 1 });
  }

  _enter(state) { this.reset(); this.state = state; this.onState?.(state); }

  idle() { this._enter("idle"); this.tl = A.idle(this.p); }
  wave() { this._enter("wave"); this.tl = A.wave(this.p); }
  walk(mode) { this._enter("walk"); this.walkMode = mode; this.tl = A.walk(this.p, mode); }
  hit() { this._enter("hit"); this.tl = A.hit(this.p, { onDone: () => this.idle() }); }

  /** opts: { side, onLunge, onPunch } */
  attack(opts = {}) {
    this._enter("attack");
    if (opts.side) this.setDir(opts.side);
    this.tl = A.attack(this.p, { ...opts, side: this.dir, onDone: () => this.idle() });
  }

  play(type, opts) { this[type](opts); }

  pop() {
    gsap.fromTo(this.p.head, { scaleX: 0.1, scaleY: 1.2 },
      { scaleX: 1, scaleY: 1, duration: 0.4, ease: "back.out(1.7)", overwrite: "auto" });
  }

  destroy() { this.tl?.kill(); gsap.killTweensOf(this.joints); }
}
