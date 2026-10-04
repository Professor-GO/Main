/**
 * The physics of the capsules tumbling inside the gashapon machine's globe: gravity, bouncing
 * off the glass and off each other, and the shaking that tosses them about during a pull.
 * Nothing here touches the DOM, so it runs (and is tested) in Node.
 */

/** One capsule: where it is, how fast it is moving, and how far it has turned (in radians). */
export type Capsule = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  // Which capsule picture it uses.
  colour: number;
};

/** The globe the capsules are in: a circle, with everything measured in canvas pixels. */
export type Globe = {
  x: number;
  y: number;
  radius: number;
  capsuleRadius: number;
};

// How hard gravity pulls, in pixels a second each second; how much speed a bounce keeps;
// and how quickly a capsule's speed drains away each second.
const GRAVITY = 900;
const BOUNCE = 0.55;
const DRAG = 0.6;

/**
 * Fills the globe with capsules, spread out so that none start inside another.
 * @param globe - The globe.
 * @param count - How many capsules.
 * @param colours - How many capsule pictures there are to choose from.
 * @param random - A random number generator, such as Math.random.
 * @returns The capsules, at rest.
 */
export function createCapsules(
  globe: Globe,
  count: number,
  colours: number,
  random: () => number,
): Capsule[] {
  const capsules: Capsule[] = [];
  for (let attempt = 0; attempt < 500 && capsules.length < count; attempt++) {
    const reach = (globe.radius - globe.capsuleRadius) * Math.sqrt(random());
    const turn = random() * Math.PI * 2;
    const x = globe.x + Math.cos(turn) * reach;
    const y = globe.y + Math.sin(turn) * reach;
    if (
      capsules.some(
        (other) =>
          Math.hypot(other.x - x, other.y - y) < globe.capsuleRadius * 2,
      )
    )
      continue;
    capsules.push({
      x,
      y,
      vx: 0,
      vy: 0,
      angle: random() * Math.PI * 2,
      colour: capsules.length % Math.max(1, colours),
    });
  }
  return capsules;
}

/**
 * Tosses every capsule in a random direction, as when the machine is shaken.
 * @param capsules - The capsules; their speeds are changed in place.
 * @param strength - The most speed a toss adds, in pixels a second.
 * @param random - A random number generator, such as Math.random.
 */
export function shakeCapsules(
  capsules: Capsule[],
  strength: number,
  random: () => number,
): void {
  for (const capsule of capsules) {
    capsule.vx += (random() - 0.5) * 2 * strength;
    // Mostly upwards, so they jump off the bottom of the globe.
    capsule.vy -= random() * strength;
  }
}

/**
 * Moves the capsules on by one step: they fall, bounce off the inside of the globe, and push
 * each other apart. A capsule turns as it moves sideways, so it looks like it is rolling.
 * @param capsules - The capsules; they are changed in place.
 * @param globe - The globe they are in.
 * @param seconds - How long the step lasts. Keep it short (a frame) for stable bouncing.
 */
export function stepCapsules(
  capsules: Capsule[],
  globe: Globe,
  seconds: number,
): void {
  const limit = globe.radius - globe.capsuleRadius;
  // Puts a capsule that has gone through the glass back against the inside of it.
  const keepInside = (capsule: Capsule) => {
    const distance = Math.hypot(capsule.x - globe.x, capsule.y - globe.y);
    if (distance <= limit) return;
    capsule.x = globe.x + ((capsule.x - globe.x) / distance) * limit;
    capsule.y = globe.y + ((capsule.y - globe.y) / distance) * limit;
  };
  for (const capsule of capsules) {
    capsule.vy += GRAVITY * seconds;
    const drag = Math.max(0, 1 - DRAG * seconds);
    capsule.vx *= drag;
    capsule.vy *= drag;
    capsule.x += capsule.vx * seconds;
    capsule.y += capsule.vy * seconds;
    capsule.angle += (capsule.vx * seconds) / globe.capsuleRadius;

    // Bounce off the glass: push the capsule back inside and reflect its speed.
    const offsetX = capsule.x - globe.x;
    const offsetY = capsule.y - globe.y;
    const distance = Math.hypot(offsetX, offsetY);
    if (distance > limit) {
      const normalX = offsetX / distance;
      const normalY = offsetY / distance;
      capsule.x = globe.x + normalX * limit;
      capsule.y = globe.y + normalY * limit;
      const outward = capsule.vx * normalX + capsule.vy * normalY;
      if (outward > 0) {
        capsule.vx -= (1 + BOUNCE) * outward * normalX;
        capsule.vy -= (1 + BOUNCE) * outward * normalY;
      }
    }
  }
  // Push overlapping capsules apart and swap the speed along the line between them.
  for (let first = 0; first < capsules.length; first++) {
    for (let second = first + 1; second < capsules.length; second++) {
      const a = capsules[first];
      const b = capsules[second];
      const offsetX = b.x - a.x;
      const offsetY = b.y - a.y;
      const distance = Math.hypot(offsetX, offsetY) || 0.001;
      const overlap = globe.capsuleRadius * 2 - distance;
      if (overlap <= 0) continue;
      const normalX = offsetX / distance;
      const normalY = offsetY / distance;
      a.x -= (normalX * overlap) / 2;
      a.y -= (normalY * overlap) / 2;
      b.x += (normalX * overlap) / 2;
      b.y += (normalY * overlap) / 2;
      const closing = (a.vx - b.vx) * normalX + (a.vy - b.vy) * normalY;
      if (closing > 0) {
        const push = ((1 + BOUNCE) * closing) / 2;
        a.vx -= push * normalX;
        a.vy -= push * normalY;
        b.vx += push * normalX;
        b.vy += push * normalY;
      }
    }
  }
  // Pushing capsules apart can nudge one through the glass, so put those back.
  capsules.forEach(keepInside);
}
