import type { FighterArt } from "./rig";

const heads = import.meta.glob<string>(
  "../../../../Assets/battle/heads/*.webp",
  { eager: true, query: "?url", import: "default" },
);
/** Original archive roster, mapped to the game's stable professor IDs. */
const styles: Record<
  string,
  { name: string; widths: [number, number]; body: FighterArt["body"] }
> = {
  "chao-liu": {
    name: "Chao Liu",
    widths: [192, 212],
    body: {
      c: "#e2e8f0",
      d: "#64748b",
      s: "#38bdf8",
      t: 16,
      l: 14,
      f: 26,
      h: 0,
    },
  },
  "craig-scratchley": {
    name: "Craig Scratchley",
    widths: [195, 190],
    body: {
      c: "#fde047",
      d: "#8a7a22",
      s: "#f97316",
      t: 14,
      l: 12,
      f: 30,
      h: 6,
    },
  },
  "frank-wood": {
    name: "Frank Wood",
    widths: [159, 171],
    body: {
      c: "#c084fc",
      d: "#6b4a8c",
      s: "#f0abfc",
      t: 18,
      l: 16,
      f: 24,
      h: 0,
    },
  },
  "guy-lumieux": {
    name: "Guy Lumieux",
    widths: [183, 193],
    body: {
      c: "#4ade80",
      d: "#2f7d4f",
      s: "#f8fafc",
      t: 15,
      l: 13,
      f: 28,
      h: 5,
    },
  },
  "michael-seica": {
    name: "Michael Seica",
    widths: [179, 190],
    body: {
      c: "#60a5fa",
      d: "#3b5f94",
      s: "#fbbf24",
      t: 16,
      l: 15,
      f: 22,
      h: 0,
    },
  },
  "shervin-jannesar": {
    name: "Shervin Jannesar",
    widths: [188, 202],
    body: {
      c: "#f9a8d4",
      d: "#9d5a7e",
      s: "#e2e8f0",
      t: 17,
      l: 14,
      f: 32,
      h: 6,
    },
  },
  "tor-aamodt": {
    name: "Tor Aamodt",
    widths: [210, 228],
    body: {
      c: "#fb923c",
      d: "#9a5a2a",
      s: "#fef3c7",
      t: 13,
      l: 12,
      f: 26,
      h: 5,
    },
  },
};
export const STUDENT_FIGHTER: FighterArt = {
  id: "student",
  name: "Student",
  body: { c: "#b5db8b", d: "#6e8c53", s: "#f6e6a7", t: 16, l: 14, f: 26, h: 4 },
};

/** Finds the archive's head cutouts and body style, with a neutral rig for future roster entries. */
export function fighterArt(id: string, name?: string): FighterArt {
  const style = styles[id];
  if (!style) return { ...STUDENT_FIGHTER, id, name: name ?? id };
  const slug = id.replaceAll("-", "_");
  const front = heads[`../../../../Assets/battle/heads/${slug}_front.webp`];
  const back = heads[`../../../../Assets/battle/heads/${slug}_back.webp`];
  return {
    id,
    name: name ?? style.name,
    body: style.body,
    ...(front ? { front: { src: front, w: style.widths[0], h: 256 } } : {}),
    ...(back ? { back: { src: back, w: style.widths[1], h: 256 } } : {}),
  };
}
