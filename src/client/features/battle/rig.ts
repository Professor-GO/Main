/** Joint locations and types adapted from Assets/stickman-react.zip. Coordinates are local to each rig. */
export const PIVOTS = {
  actor: [200, 527],
  stickman: [200, 320],
  flip: [200, 320],
  upper: [200, 320],
  head: [200, 170],
  headFace: [200, 100],
  armLeft: [200, 185],
  armRight: [200, 185],
  forearmLeft: [200, 255],
  forearmRight: [200, 255],
  legLeft: [196, 320],
  legRight: [204, 320],
  shinLeft: [196, 420],
  shinRight: [204, 420],
} as const;
export type Joint = keyof typeof PIVOTS;
export type RigParts = Partial<Record<Joint, SVGGElement | null>>;
export type HeadArt = { src: string; w: number; h: number };
export type BodyStyle = {
  c: string;
  d: string;
  s: string;
  t: number;
  l: number;
  f: number;
  h: number;
};
export type FighterArt = {
  id: string;
  name: string;
  front?: HeadArt;
  back?: HeadArt;
  body: BodyStyle;
};

/** Anchors a transparent portrait's chin to the neck, preserving its original aspect ratio. */
export function headProps(head: HeadArt) {
  const width = (140 * head.w) / head.h;
  return { href: head.src, width, height: 140, x: 200 - width / 2, y: 32 };
}
