import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { headProps } from "../rig/head.js";
import { depthScale } from "./world.js";

/** Static target with an HP bar. ref.hit(side) = recoil away from the attacker (side: 1 = hit from the left). */
const Enemy = forwardRef(function Enemy({ head, x, y }, ref) {
  const root = useRef(), body = useRef(), fill = useRef(), hp = useRef(100);

  useLayoutEffect(() => {
    gsap.set(root.current, { svgOrigin: "200 527", x: x - 200, y: y - 527, scale: depthScale(y) });
    gsap.set(body.current, { svgOrigin: "200 520" });
  }, [x, y]);

  useImperativeHandle(ref, () => ({
    hit(side) {
      hp.current -= 25;
      gsap.set(fill.current, { attr: { width: Math.max(0, hp.current) } });
      gsap.timeline()
        .to(body.current, { x: side * 18, rotation: side * 8, duration: 0.08 })
        .to(body.current, { x: 0, rotation: 0, duration: 0.4, ease: "elastic.out(1,.4)" });
      if (hp.current <= 0) {
        gsap.to(root.current, { opacity: 0, duration: 0.4, delay: 0.3, onComplete: () => {
          hp.current = 100;
          gsap.set(fill.current, { attr: { width: 100 } });
          gsap.to(root.current, { opacity: 1, duration: 0.4 });
        } });
      }
    },
  }));

  return (
    <g ref={root} fill="none" strokeLinecap="round" stroke="#fb7185">
      <ellipse cx="200" cy="527" rx="55" ry="7" fill="rgba(0,0,0,.5)" stroke="none" />
      <g ref={body}>
        <g strokeWidth="14">
          <line x1="196" y1="320" x2="192" y2="520" /><line x1="192" y1="520" x2="166" y2="520" />
          <line x1="204" y1="320" x2="208" y2="520" /><line x1="208" y1="520" x2="234" y2="520" />
        </g>
        <line x1="200" y1="170" x2="200" y2="320" strokeWidth="16" />
        <path d="M200 185 L168 250 L178 312" strokeWidth="11" />
        <path d="M200 185 L232 250 L222 312" strokeWidth="11" />
        <image {...headProps(head)} preserveAspectRatio="xMidYMax meet" />
      </g>
      <rect x="150" y="8" width="100" height="8" rx="4" fill="#1e293b" stroke="none" />
      <rect ref={fill} x="150" y="8" width="100" height="8" rx="4" fill="#f43f5e" stroke="none" />
    </g>
  );
});
export default Enemy;
