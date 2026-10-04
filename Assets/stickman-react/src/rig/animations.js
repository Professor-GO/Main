import gsap from "gsap";

// Rotation: + = clockwise (limb swings back), - = swings forward. Body faces right.
// Every builder takes `p` (map of joint elements) and returns a gsap timeline.
const E = "sine.inOut";
const JOINTS = (p) => [p.stickman, p.upper, p.head, p.armLeft, p.armRight, p.forearmLeft, p.forearmRight,
  p.legLeft, p.legRight, p.shinLeft, p.shinRight];

export const idle = (p) =>
  gsap.timeline({ repeat: -1, yoyo: true, defaults: { duration: 2, ease: E } })
    .to(p.upper, { rotation: 2 }, 0)
    .to(p.head, { rotation: -1.5, y: 2 }, 0)
    .to(p.armLeft, { rotation: 3 }, 0)
    .to(p.armRight, { rotation: -3 }, 0);

export const wave = (p) =>
  gsap.timeline()
    .to(p.armRight, { rotation: -150, duration: 0.4, ease: "power2.out" }, 0)
    .to(p.forearmRight, { rotation: -25, duration: 0.4, ease: "power2.out" }, 0)
    .to(p.head, { rotation: -5, duration: 0.6, ease: E, repeat: -1, yoyo: true }, 0.4)
    .to(p.forearmRight, { rotation: 25, duration: 0.3, ease: E, repeat: -1, yoyo: true }, 0.4);

/** mode "side": full stride (left/right). mode "vert": small steps (toward/away from screen). */
export function walk(p, mode) {
  const side = mode === "side", t = side ? 0.4 : 0.35;
  const tl = gsap.timeline({ repeat: -1, yoyo: true });
  const f = (el, a, b) => tl.fromTo(el, { rotation: a }, { rotation: b, duration: t, ease: E }, 0);
  if (side) {
    f(p.legLeft, 30, -30); f(p.legRight, -30, 30);
    f(p.shinLeft, 50, 5); f(p.shinRight, 5, 50);
    f(p.armLeft, -30, 30); f(p.armRight, 30, -30);
    f(p.forearmLeft, -10, -40); f(p.forearmRight, -40, -10);
    f(p.upper, 2, 4);
  } else {
    f(p.legLeft, 8, -8); f(p.legRight, -8, 8);
    f(p.shinLeft, 25, 0); f(p.shinRight, 0, 25);
    f(p.armLeft, -10, 10); f(p.armRight, 10, -10);
  }
  tl.fromTo(p.stickman, { y: 0 }, { y: side ? -8 : -6, duration: t / 2, ease: E, repeat: 1, yoyo: true }, 0);
  return tl;
}

/** onLunge(tl): add the movement tween at time 0. onPunch fires at impact. */
export function attack(p, { side, onLunge, onPunch, onDone }) {
  const tl = gsap.timeline();
  onLunge?.(tl);
  tl.to(p.upper, { rotation: -10, duration: 0.3, ease: "power1.in" }, 0)
    .to(p.armRight, { rotation: 80, duration: 0.3, ease: "power1.in" }, 0)
    .to(p.forearmRight, { rotation: -90, duration: 0.3, ease: "power1.in" }, 0)
    .to(p.legRight, { rotation: 10, duration: 0.3 }, 0)
    .to(p.legLeft, { rotation: -12, duration: 0.3 }, 0)
    .to(p.upper, { rotation: 15, duration: 0.1, ease: "power4.out" }, 0.3)
    .to(p.stickman, { x: 15 * side, duration: 0.1, ease: "power4.out" }, 0.3)
    .to(p.armRight, { rotation: -90, duration: 0.1, ease: "power4.out" }, 0.3)
    .to(p.forearmRight, { rotation: 0, duration: 0.1, ease: "power4.out" }, 0.3)
    .to(p.legRight, { rotation: -15, duration: 0.1 }, 0.3)
    .call(() => onPunch?.(), [], 0.36)
    .to({}, { duration: 0.15 })
    .to(JOINTS(p), { rotation: 0, x: 0, y: 0, duration: 0.4, ease: "power2.out" })
    .call(() => onDone?.());
  return tl;
}

export function hit(p, { onDone }) {
  const d = 0.1;
  return gsap.timeline()
    .to(p.stickman, { x: -30, duration: d, ease: "power4.out" }, 0)
    .to(p.upper, { rotation: -25, duration: d, ease: "power4.out" }, 0)
    .to(p.head, { rotation: -25, y: -4, duration: d }, 0)
    .to(p.armLeft, { rotation: 50, duration: d }, 0)
    .to(p.forearmLeft, { rotation: -30, duration: d }, 0)
    .to(p.armRight, { rotation: -50, duration: d }, 0)
    .to(p.forearmRight, { rotation: -40, duration: d }, 0)
    .to(p.legLeft, { rotation: 15, duration: d }, 0)
    .to(p.shinLeft, { rotation: 30, duration: d }, 0)
    .to(p.legRight, { rotation: -10, duration: d }, 0)
    .to(p.shinRight, { rotation: 20, duration: d }, 0)
    .to(JOINTS(p), { rotation: 0, x: 0, y: 0, duration: 0.6, delay: 0.2, ease: "back.out(1.2)" })
    .call(() => onDone?.());
}
