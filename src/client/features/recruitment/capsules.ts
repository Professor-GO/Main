/**
 * The capsules tumbling around inside the gashapon globe. Pure physics with no drawing, so
 * it can be tested on its own. Positions are in globe units: the globe is a circle of
 * radius 1 centred on (0, 0), x grows to the right and y grows downward.
 */

/** The capsule colours in Assets/gacha. */
export type CapsuleColor = "yellow" | "pink" | "blue" | "green" | "orange" | "red";

/** The capsule a professor of each rarity arrives in. Orange and red only fill the globe. */
export const CAPSULE_FOR = {
  Legendary: "yellow",
  Epic: "pink",
  Rare: "blue",
  Common: "green",
} as const satisfies Record<string, CapsuleColor>;

export type Capsule = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  // How far the capsule has turned, in radians, and how fast it turns.
  angle: number;
  spin: number;
  color: CapsuleColor;
};

/** Every capsule's radius, in globe units. */
export const CAPSULE_RADIUS = 0.15;
// Downward pull, in globe units per second squared.
const GRAVITY = 4.5;
// Share of speed a capsule keeps after hitting the glass or another capsule.
const BOUNCE = 0.55;
// Share of speed a capsule keeps each second from air and rolling friction.
const DRAG = 0.6;
// How hard a shake throws the capsules, in globe units per second.
const SHAKE_KICK = 2.6;
const GLOBE_COLORS: readonly CapsuleColor[] = [
  "yellow",
  "pink",
  "blue",
  "green",
  "orange",
  "red",
];

/**
 * Fills the bottom of the globe with resting capsules, in rows from the bottom up.
 * @param count - How many capsules to make.
 * @param random - Returns a number from 0 to 1; tests pass a fixed one.
 * @returns The capsules, each inside the globe and clear of the others.
 */
export function createCapsules(
  count: number,
  random: () => number = Math.random,
): Capsule[] {
  const capsules: Capsule[] = [];
  const step = CAPSULE_RADIUS * 2.05;
  for (let y = 1 - CAPSULE_RADIUS; capsules.length < count && y > -1; y -= step) {
    // The widest row that still fits inside the circle at this height.
    const half = Math.sqrt(Math.max(0, (1 - CAPSULE_RADIUS) ** 2 - y * y));
    const fit = Math.floor((2 * half) / step) + 1;
    for (let i = 0; i < fit && capsules.length < count; i++) {
      capsules.push({
        x: fit === 1 ? 0 : -half + (i * 2 * half) / (fit - 1),
        y,
        vx: 0,
        vy: 0,
        angle: random() * Math.PI * 2,
        spin: 0,
        color: GLOBE_COLORS[capsules.length % GLOBE_COLORS.length],
      });
    }
  }
  return capsules;
}

/**
 * Throws every capsule in a random direction, mostly upward, as when the machine is shaken.
 * @param capsules - The capsules to throw. They are changed in place.
 * @param random - Returns a number from 0 to 1.
 */
export function shake(capsules: Capsule[], random: () => number = Math.random) {
  for (const capsule of capsules) {
    capsule.vx += (random() - 0.5) * 2 * SHAKE_KICK;
    capsule.vy -= (0.4 + random() * 0.8) * SHAKE_KICK;
    capsule.spin += (random() - 0.5) * 12;
  }
}

/**
 * Moves the capsules forward in time: gravity pulls them down, they bounce off the glass and
 * each other, and they slow down.
 * @param capsules - The capsules to move. They are changed in place.
 * @param seconds - How much time passes. Long gaps are split into small steps.
 */
export function stepCapsules(capsules: Capsule[], seconds: number) {
  const steps = Math.max(1, Math.ceil(seconds / 0.008));
  const dt = seconds / steps;
  const keep = DRAG ** dt;
  const limit = 1 - CAPSULE_RADIUS;
  for (let s = 0; s < steps; s++) {
    for (const capsule of capsules) {
      capsule.vy += GRAVITY * dt;
      capsule.vx *= keep;
      capsule.vy *= keep;
      capsule.spin *= keep;
      capsule.x += capsule.vx * dt;
      capsule.y += capsule.vy * dt;
      capsule.angle += capsule.spin * dt;
      // Keep the capsule inside the glass and bounce it back.
      const distance = Math.hypot(capsule.x, capsule.y);
      if (distance > limit) {
        const nx = capsule.x / distance;
        const ny = capsule.y / distance;
        capsule.x = nx * limit;
        capsule.y = ny * limit;
        const outward = capsule.vx * nx + capsule.vy * ny;
        if (outward > 0) {
          capsule.vx -= (1 + BOUNCE) * outward * nx;
          capsule.vy -= (1 + BOUNCE) * outward * ny;
          // Rolling along the glass turns the capsule.
          capsule.spin += (capsule.vx * -ny + capsule.vy * nx) * 2;
        }
      }
    }
    // Push overlapping capsules apart and bounce them off each other.
    for (let i = 0; i < capsules.length; i++) {
      for (let j = i + 1; j < capsules.length; j++) {
        const a = capsules[i];
        const b = capsules[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        const overlap = CAPSULE_RADIUS * 2 - distance;
        if (overlap <= 0 || distance === 0) continue;
        const nx = dx / distance;
        const ny = dy / distance;
        a.x -= (nx * overlap) / 2;
        a.y -= (ny * overlap) / 2;
        b.x += (nx * overlap) / 2;
        b.y += (ny * overlap) / 2;
        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (closing > 0) {
          const push = ((1 + BOUNCE) * closing) / 2;
          a.vx -= push * nx;
          a.vy -= push * ny;
          b.vx += push * nx;
          b.vy += push * ny;
        }
      }
    }
  }
}
