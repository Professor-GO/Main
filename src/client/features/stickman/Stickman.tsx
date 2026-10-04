import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { StickmanController } from "./StickmanController";
import StickmanRig from "./StickmanRig";
import type { RigParts } from "./StickmanRig";
import type { StickmanLook } from "./looks";

/** What a parent can ask a drawn stickman to do. */
export type StickmanHandle = {
  // The SVG group to move around; its feet are at the group's origin.
  readonly element: SVGGElement | null;
  readonly controller: StickmanController | null;
};

/** The rig's feet, which are moved to the group's origin. */
const FEET = { x: 200, y: 527 };

/**
 * One animated stickman, as an SVG group whose origin is at the stickman's feet. Put it inside
 * an <svg> and move it by setting a transform on `element`; drive its animations through
 * `controller`. It starts out standing and breathing.
 */
const Stickman = forwardRef<
  StickmanHandle,
  {
    look: StickmanLook;
    // Which head picture to show: the front or the back of the head.
    facing?: "front" | "back";
    // The size of the stickman: 1 draws the rig at its own 400 × 600 size.
    scale?: number;
    className?: string;
  }
>(function Stickman({ look, facing = "front", scale = 1, className }, ref) {
  const element = useRef<SVGGElement>(null);
  const parts = useRef<RigParts>({});
  const controller = useRef<StickmanController | null>(null);

  useLayoutEffect(() => {
    const created = new StickmanController(parts.current).setup();
    created.idle();
    controller.current = created;
    return () => {
      created.destroy();
      controller.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    get element() {
      return element.current;
    },
    get controller() {
      return controller.current;
    },
  }));

  return (
    <g ref={element} className={className}>
      <g transform={`scale(${scale}) translate(${-FEET.x} ${-FEET.y})`}>
        <StickmanRig parts={parts} body={look.body} head={look[facing]} />
      </g>
    </g>
  );
});
export default Stickman;
