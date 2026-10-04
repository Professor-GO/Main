import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import StickmanRig from "../rig/StickmanRig.jsx";
import { StickmanController } from "../rig/StickmanController.js";
import { FEET } from "../rig/pivots.js";
import Enemy from "./Enemy.jsx";
import { BOUNDS, ENEMY_POS, SPEED, WORLD, clamp, depthScale } from "./world.js";

/**
 * 2D walkable stage: the player moves on x/y (up = farther, smaller), the nearer
 * of player/enemy is drawn in front. ref: { play(type), pop() }.
 */
const Stage = forwardRef(function Stage({ professor, enemyProfessor, facing, input, onFacing, onState }, ref) {
  const parts = useRef({});
  const ctl = useRef(null);
  const pos = useRef({ x: 300, y: 420 });
  const enemy = useRef(null);
  const live = useRef({});
  const front = useRef(true);
  const [actorInFront, setActorInFront] = useState(true);
  live.current = { facing, input, onFacing, onState };

  const place = () => {
    const { x, y } = pos.current;
    gsap.set(parts.current.actor, { x: x - FEET.x, y: y - FEET.y, scale: depthScale(y) });
    const f = y >= ENEMY_POS.y;
    if (f !== front.current) { front.current = f; setActorInFront(f); }
  };

  useLayoutEffect(() => {
    const c = new StickmanController(parts.current).setup();
    c.onState = (s) => live.current.onState?.(s);
    ctl.current = c;
    place();
    c.idle();
    return () => c.destroy();
  }, []);

  useEffect(() => {
    const tick = (_, dtMs) => {
      const c = ctl.current, { input, facing, onFacing } = live.current;
      if (!c || c.busy) return;
      const v = input.vec();
      if (!v.x && !v.y) { if (c.state === "walk") c.idle(); return; }
      const mode = v.x ? "side" : "vert";
      if (c.state !== "walk" || c.walkMode !== mode) c.walk(mode);
      if (v.x && v.x !== c.dir) c.setDir(v.x);
      if (v.y) { const want = v.y > 0 ? "front" : "back"; if (want !== facing) onFacing(want); }  // up: back, down: front
      const step = (SPEED * Math.min(dtMs, 50)) / 1000 / Math.hypot(v.x, v.y);
      const p = pos.current;
      p.x = clamp(p.x + v.x * step, BOUNDS.x0, BOUNDS.x1);
      p.y = clamp(p.y + v.y * step * 0.6, BOUNDS.y0, BOUNDS.y1);
      place();
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);

  useImperativeHandle(ref, () => ({
    pop: () => ctl.current.pop(),
    play(type) {
      const c = ctl.current;
      if (type !== "attack") return c.play(type);
      if (c.busy) return;
      const side = pos.current.x <= ENEMY_POS.x ? 1 : -1;       // dash diagonally to the enemy, then punch
      const tx = clamp(ENEMY_POS.x - side * 75, BOUNDS.x0, BOUNDS.x1);
      c.attack({
        side,
        onLunge: (tl) => tl.to(pos.current, { x: tx, y: ENEMY_POS.y, duration: 0.3, ease: "power2.out", onUpdate: place }, 0),
        onPunch: () => enemy.current?.hit(side),
      });
    },
  }));

  const actor = <StickmanRig key="actor" parts={parts} body={professor.body} head={professor[facing]} />;
  const foe = <Enemy key="enemy" ref={enemy} head={enemyProfessor.front} x={ENEMY_POS.x} y={ENEMY_POS.y} />;

  return (
    <svg className="stage" viewBox={`0 0 ${WORLD.w} ${WORLD.h}`}>
      <rect x="0" y={WORLD.floor} width={WORLD.w} height={WORLD.h - WORLD.floor} fill="rgba(2,6,23,.55)" />
      <line x1="0" y1={WORLD.floor} x2={WORLD.w} y2={WORLD.floor} stroke="#334155" strokeWidth="2" />
      {actorInFront ? [foe, actor] : [actor, foe]}
    </svg>
  );
});
export default Stage;
