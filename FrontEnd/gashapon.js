// The recruit page's gashapon machine: capsules bounce around the glass globe while a pull
// is made, then the prize's capsule drops out of the chute and opens to show the professor
// that the gacha system picked, in the cage that matches their rarity.
//
// Positions are worked out in the machine picture's own pixels (409 × 828) and scaled to
// however big the picture is on screen.

// The size of Assets/gacha/gashapon_machine_front.png, in pixels.
const MACHINE = { width: 409, height: 828 };
// The glass globe: capsules bounce inside this circle.
const GLOBE = { x: 203, y: 236, radius: 162 };
// Where capsules come out: the dark opening near the bottom of the machine.
const CHUTE = { x: 180, y: 700 };
const BALL_RADIUS = 27;
const BALL_COUNT = 14;
const GRAVITY = 1500;
// How much speed a capsule keeps when it hits the glass (wall) or another capsule.
const WALL_BOUNCE = 0.5;
const BALL_BOUNCE = 0.6;
// The size of the opened capsule in the middle of the stage, in screen pixels (see .reveal-capsule).
const REVEAL_SIZE = 120;

const CAPSULE_COLORS = ["red", "blue", "green", "orange", "pink", "yellow"];
// The capsule each rarity of professor comes in.
const RARITY_CAPSULES = { Legendary: "yellow", Epic: "pink", Rare: "blue", Common: "green" };

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Finds the picture of a capsule.
 * @param {string} color - One of CAPSULE_COLORS.
 * @returns {string} The picture's URL.
 */
const capsuleImage = (color) => `/Assets/gacha/capsule_${color}.png`;

/**
 * What the machine shows for one pull. This file never reads the server's reply directly;
 * app.js turns the reply into one of these (see toShownPrize there), so a change to the
 * backend only needs a change in that one place.
 * @typedef {object} ShownPrize
 * @property {{ name: string, image: string, rarity: string }} professor - The professor the
 *   gacha system picked, with the URL of their picture and their rarity.
 * @property {{ name: string, image: string }} cage - The cage the gacha system put them in.
 */

/**
 * Picks the capsule color for a prize.
 * @param {ShownPrize} prize - The prize.
 * @returns {string} One of CAPSULE_COLORS. Unknown rarities get red.
 */
export function capsuleColorFor(prize) {
    return RARITY_CAPSULES[prize.professor.rarity] ?? "red";
}

/**
 * Waits for a number of milliseconds.
 * @param {number} ms - How long to wait.
 * @returns {Promise<void>} Resolves after the wait.
 */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Plays a Web Animation and waits for it to finish. With reduced motion, it jumps to the end.
 * @param {Element} element - The element to animate.
 * @param {Keyframe[]} keyframes - The keyframes.
 * @param {KeyframeAnimationOptions} options - Duration, easing, and so on.
 * @returns {Promise<void>} Resolves when the animation ends.
 */
async function play(element, keyframes, options) {
    const animation = element.animate(keyframes, { fill: "forwards", ...options, duration: reducedMotion.matches ? 1 : options.duration });
    await animation.finished.catch(() => {});
}

/**
 * Fills the globe with bouncing capsules.
 * @param {HTMLElement} layer - The element laid over the machine picture that holds the capsules.
 * @returns {{ mix(): void, settle(): void, takeBall(color: string): void, refill(): void }}
 *   mix() starts shaking the capsules around, settle() lets them fall back down,
 *   takeBall() removes a capsule of that color (as if it went down the chute), and
 *   refill() drops a new capsule in for each one taken.
 */
export function createGlobe(layer) {
    const balls = [];
    const taken = [];
    let mixing = false;
    let frame = 0;
    let lastTime = 0;
    let nextKick = 0;
    let calmFor = 0;

    /**
     * Adds a capsule to the globe.
     * @param {string} color - The capsule's color.
     * @param {number} x - Where it starts, in machine pixels.
     * @param {number} y - Where it starts, in machine pixels.
     */
    function addBall(color, x, y) {
        const element = document.createElement("img");
        element.src = capsuleImage(color);
        element.alt = "";
        element.draggable = false;
        element.className = "machine-ball";
        layer.append(element);
        balls.push({ color, element, x, y, vx: (Math.random() - 0.5) * 200, vy: 0, angle: Math.random() * 360 });
    }

    /**
     * Moves every capsule forward by dt seconds: gravity, random kicks while mixing,
     * bounces off each other, and bounces off the glass.
     * @param {number} dt - The time step, in seconds.
     */
    function step(dt) {
        if (mixing && (nextKick -= dt) <= 0) {
            nextKick = 0.08;
            for (const ball of balls) {
                if (Math.random() < 0.5) continue;
                ball.vx += (Math.random() - 0.5) * 900;
                ball.vy -= 300 + Math.random() * 700;
            }
        }
        const drag = 1 - 0.8 * dt;
        for (const ball of balls) {
            ball.vy += GRAVITY * dt;
            ball.vx *= drag;
            ball.vy *= drag;
            ball.x += ball.vx * dt;
            ball.y += ball.vy * dt;
            ball.angle += ball.vx * dt * 1.2;
        }
        // Capsules that overlap are pushed apart and bounce off each other.
        for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
                const a = balls[i];
                const b = balls[j];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const distance = Math.hypot(dx, dy);
                if (distance >= BALL_RADIUS * 2 || distance === 0) continue;
                const nx = dx / distance;
                const ny = dy / distance;
                const overlap = (BALL_RADIUS * 2 - distance) / 2;
                a.x -= nx * overlap; a.y -= ny * overlap;
                b.x += nx * overlap; b.y += ny * overlap;
                const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                if (closing >= 0) continue;
                const impulse = -(1 + BALL_BOUNCE) * closing / 2;
                a.vx -= impulse * nx; a.vy -= impulse * ny;
                b.vx += impulse * nx; b.vy += impulse * ny;
            }
        }
        // Capsules stay inside the glass.
        const limit = GLOBE.radius - BALL_RADIUS;
        for (const ball of balls) {
            const dx = ball.x - GLOBE.x;
            const dy = ball.y - GLOBE.y;
            const distance = Math.hypot(dx, dy);
            if (distance <= limit) continue;
            const nx = dx / distance;
            const ny = dy / distance;
            ball.x = GLOBE.x + nx * limit;
            ball.y = GLOBE.y + ny * limit;
            const outward = ball.vx * nx + ball.vy * ny;
            if (outward > 0) {
                ball.vx -= (1 + WALL_BOUNCE) * outward * nx;
                ball.vy -= (1 + WALL_BOUNCE) * outward * ny;
            }
        }
    }

    // Draws every capsule at its position, scaled to the machine's size on screen.
    function render() {
        const scale = layer.clientWidth / MACHINE.width;
        for (const ball of balls) {
            ball.element.style.transform = `translate(${(ball.x - BALL_RADIUS) * scale}px, ${(ball.y - BALL_RADIUS) * scale}px) rotate(${ball.angle}deg)`;
        }
    }

    // Runs the simulation each frame until the capsules have been still for a moment.
    function tick(time) {
        const dt = Math.min((time - lastTime) / 1000 || 0, 1 / 30);
        lastTime = time;
        for (let substep = 0; substep < 3; substep++) step(dt / 3);
        render();
        const moving = balls.some((ball) => Math.hypot(ball.vx, ball.vy) > 25);
        calmFor = moving || mixing ? 0 : calmFor + dt;
        frame = calmFor > 0.6 ? 0 : requestAnimationFrame(tick);
    }

    // Starts the simulation if it is not already running.
    function wake() {
        calmFor = 0;
        if (frame) return;
        lastTime = performance.now();
        frame = requestAnimationFrame(tick);
    }

    for (let index = 0; index < BALL_COUNT; index++) {
        addBall(CAPSULE_COLORS[index % CAPSULE_COLORS.length], GLOBE.x + (Math.random() - 0.5) * 220, GLOBE.y + (Math.random() - 0.2) * 120);
    }
    // Let the capsules fall into a pile, then draw them there.
    for (let index = 0; index < 400; index++) step(1 / 120);
    for (const ball of balls) { ball.vx = 0; ball.vy = 0; }
    render();
    // Keep the capsules in place when the page is resized.
    new ResizeObserver(render).observe(layer);

    return {
        mix() {
            if (reducedMotion.matches) return;
            mixing = true;
            nextKick = 0;
            wake();
        },
        settle() {
            mixing = false;
            wake();
        },
        takeBall(color) {
            const index = Math.max(0, balls.findIndex((ball) => ball.color === color));
            const [ball] = balls.splice(index, 1);
            if (!ball) return;
            taken.push(ball.color);
            ball.element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" }).finished
                .catch(() => {}).finally(() => ball.element.remove());
        },
        refill() {
            // New capsules drop in from the top of the globe.
            for (const color of taken.splice(0)) addBall(color, GLOBE.x + (Math.random() - 0.5) * 60, GLOBE.y - GLOBE.radius + BALL_RADIUS + 4);
            wake();
        },
    };
}

/**
 * Plays the prize reveal: the capsule drops out of the chute, rolls to the middle of the
 * stage, wobbles, and pops open to show the professor in their cage.
 * @param {object} parts - The page elements used by the reveal.
 * @param {HTMLElement} parts.stage - The stage that holds the machine and the reveal.
 * @param {HTMLElement} parts.machine - The machine (its picture sets the chute position).
 * @param {HTMLElement} parts.overlay - The reveal layer over the stage.
 * @param {HTMLElement} parts.capsule - The capsule, with its two halves inside.
 * @param {HTMLImageElement} parts.top - The capsule's top half.
 * @param {HTMLImageElement} parts.bottom - The capsule's bottom half.
 * @param {HTMLElement} parts.burst - The flash of light behind the opening capsule.
 * @param {HTMLElement} parts.prizeBox - Holds the professor and cage pictures.
 * @param {HTMLImageElement} parts.professorImage - The professor's picture.
 * @param {HTMLImageElement} parts.cageImage - The cage's picture.
 * @param {ShownPrize} prize - What was pulled.
 * @returns {Promise<void>} Resolves once the prize is on show.
 */
export async function revealPrize(parts, prize) {
    const { stage, machine, overlay, capsule, top, bottom, burst, prizeBox, professorImage, cageImage } = parts;
    const { professor, cage } = prize;

    top.src = bottom.src = capsuleImage(capsuleColorFor(prize));
    professorImage.src = professor.image;
    professorImage.alt = `${professor.name} in a ${cage.name.toLowerCase()}`;
    cageImage.src = cage.image;
    overlay.dataset.rarity = professor.rarity;
    prizeBox.hidden = true;
    [capsule, top, bottom, burst, prizeBox, overlay].forEach((element) => element.getAnimations().forEach((animation) => animation.cancel()));
    overlay.hidden = false;

    // Where the chute is, measured from the middle of the stage, and how big a capsule
    // in the machine looks compared with the revealed capsule.
    const stageBox = stage.getBoundingClientRect();
    const machineBox = machine.getBoundingClientRect();
    const scale = machineBox.width / MACHINE.width;
    const chuteX = machineBox.left - stageBox.left + CHUTE.x * scale - stageBox.width / 2;
    const chuteY = machineBox.top - stageBox.top + CHUTE.y * scale - stageBox.height / 2;
    const small = (BALL_RADIUS * 2 * scale) / REVEAL_SIZE;

    // The capsule pops out of the chute, then bounces over to the middle of the stage.
    void play(overlay, [{ backgroundColor: "rgb(248 249 243 / 0)" }, { backgroundColor: "rgb(248 249 243 / .82)" }], { duration: 900, easing: "ease-out" });
    await play(capsule, [
        { transform: `translate(${chuteX}px, ${chuteY - 14 * scale}px) scale(${small})`, opacity: 0 },
        { transform: `translate(${chuteX}px, ${chuteY}px) scale(${small})`, opacity: 1, offset: 0.25 },
        { transform: `translate(${chuteX + 18}px, ${chuteY + 34}px) scale(${small}) rotate(90deg)`, opacity: 1 },
    ], { duration: 450, easing: "ease-in" });
    await play(capsule, [
        { transform: `translate(${chuteX + 18}px, ${chuteY + 34}px) scale(${small}) rotate(90deg)` },
        { transform: `translate(${chuteX / 2}px, -70px) scale(${(small + 1) / 2}) rotate(260deg)`, offset: 0.55 },
        { transform: "translate(0, 0) scale(1) rotate(360deg)" },
    ], { duration: 750, easing: "cubic-bezier(.3, .7, .4, 1)" });

    // The capsule wobbles. Legendary capsules wobble longer, to build the suspense.
    const wobbles = professor.rarity === "Legendary" ? 3 : 2;
    for (let wobble = 0; wobble < wobbles; wobble++) {
        await play(capsule, [
            { transform: "rotate(0deg)" }, { transform: "rotate(-14deg)" }, { transform: "rotate(12deg)" }, { transform: "rotate(0deg)" },
        ], { duration: 380, easing: "ease-in-out" });
        await wait(reducedMotion.matches ? 0 : 140);
    }

    // The capsule pops open with a flash, and the professor in their cage springs out of it.
    void play(top, [{ transform: "none", opacity: 1 }, { transform: "translate(-46px, -86px) rotate(-38deg)", opacity: 0 }], { duration: 650, easing: "cubic-bezier(.2, .8, .3, 1)" });
    void play(bottom, [{ transform: "none", opacity: 1 }, { transform: "translate(40px, 78px) rotate(28deg)", opacity: 0 }], { duration: 650, easing: "cubic-bezier(.2, .8, .3, 1)" });
    void play(burst, [{ transform: "scale(.2)", opacity: 0.95 }, { transform: "scale(1.9)", opacity: 0 }], { duration: 800, easing: "ease-out" });
    prizeBox.hidden = false;
    await play(prizeBox, [
        { transform: "translateY(20px) scale(.3)", opacity: 0 },
        { transform: "translateY(-10px) scale(1.06)", opacity: 1, offset: 0.65 },
        { transform: "none", opacity: 1 },
    ], { duration: 600, easing: "ease-out" });
}
