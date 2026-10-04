import { useEffect, useLayoutEffect, useRef } from "react";
import StickmanRig from "./rig/StickmanRig.jsx";
import { StickmanController } from "./rig/StickmanController.js";

/**
 * Standalone, reusable stickman for any 2D screen.
 *   <Stickman professor={PROFESSORS[0]} facing="front" action="idle" size={120} />
 * action: "idle" | "wave" | "hit" | "walk-side" | "walk-vert"
 */
export default function Stickman({ professor, facing = "front", action = "idle", dir = 1, size = 120 }) {
  const parts = useRef({});
  const ctl = useRef(null);

  useLayoutEffect(() => {
    ctl.current = new StickmanController(parts.current).setup();
    return () => ctl.current.destroy();
  }, []);

  useEffect(() => {
    const c = ctl.current;
    c.setDir(dir);
    if (action.startsWith("walk")) c.walk(action.endsWith("side") ? "side" : "vert");
    else c.play(action);
  }, [action, dir]);

  return (
    <svg viewBox="40 10 320 530" width={size} style={{ overflow: "visible" }}>
      <StickmanRig parts={parts} body={professor.body} head={professor[facing]} />
    </svg>
  );
}
