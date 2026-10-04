// Pivot of every joint, in the rig's own 400x600 coordinate space (gsap svgOrigin).
// Keys are the part names used by StickmanRig refs.
export const PIVOTS = {
  stickman: "200 320", upper: "200 320", head: "200 170",
  armLeft: "200 185", armRight: "200 185",
  forearmLeft: "200 255", forearmRight: "200 255",
  legLeft: "196 320", legRight: "204 320",
  shinLeft: "196 420", shinRight: "204 420",
};
export const EXTRA_PIVOTS = { flip: "200 320", headFace: "200 100", actor: "200 527" };
export const FEET = { x: 200, y: 527 };   // where the rig touches the ground
