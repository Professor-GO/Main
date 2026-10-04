import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { ActorView } from "../../features/world/Game Mechanics/game";
import {
  ACTOR_HEIGHT,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
} from "../../features/world/renderer";
import Stickman from "../../features/stickman/Stickman";
import type { StickmanHandle } from "../../features/stickman/Stickman";
import { lookFor } from "../../features/stickman/looks";

/** What the game loop calls each frame to move the stickmen. */
export type ActorLayerHandle = { frame(actors: readonly ActorView[]): void };

// The rig is about 500 units from the top of the head to the feet.
const SCALE = ACTOR_HEIGHT / 500;
// One stickman in the layer: who they are and which way their head faces.
type Member = { key: string; look: string; facing: "front" | "back" };

/**
 * The animated stickmen drawn over the map: the player and any wild professors in view. The
 * game loop calls `frame` every frame. Positions and animations are set directly on the SVG,
 * so React only re-renders when someone arrives, leaves, turns around, or changes order.
 */
const ActorLayer = forwardRef<ActorLayerHandle>(function ActorLayer(_, ref) {
  const [members, setMembers] = useState<Member[]>([]);
  const handles = useRef(new Map<string, StickmanHandle>());
  const signature = useRef("");

  useImperativeHandle(ref, () => ({
    frame(actors) {
      // Whoever is lower on the screen is drawn last, so they stand in front.
      const next = [...actors]
        .sort((a, b) => a.y - b.y)
        .map(
          (actor): Member => ({
            key: actor.key,
            look: actor.look,
            // Walking up the screen shows the back of the head.
            facing: actor.facing.startsWith("n") ? "back" : "front",
          }),
        );
      const nextSignature = JSON.stringify(next);
      if (nextSignature !== signature.current) {
        signature.current = nextSignature;
        setMembers(next);
      }
      for (const actor of actors) {
        const handle = handles.current.get(actor.key);
        if (!handle?.element) continue;
        handle.element.setAttribute(
          "transform",
          `translate(${actor.x.toFixed(1)} ${actor.y.toFixed(1)})`,
        );
        const controller = handle.controller;
        if (!controller) continue;
        const sideways =
          actor.facing.endsWith("e") || actor.facing.endsWith("w");
        if (sideways)
          controller.setDirection(actor.facing.endsWith("e") ? 1 : -1);
        if (actor.walking) controller.walk(sideways ? "side" : "vert");
        else if (controller.state === "walk") controller.idle();
      }
    },
  }));

  return (
    <svg
      className="world-actors"
      viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
      aria-hidden="true"
    >
      {members.map((member) => (
        <Stickman
          key={member.key}
          ref={(handle) => {
            if (handle) handles.current.set(member.key, handle);
            else handles.current.delete(member.key);
          }}
          look={lookFor(member.look)}
          facing={member.facing}
          scale={SCALE}
        />
      ))}
    </svg>
  );
});
export default ActorLayer;
