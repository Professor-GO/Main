import { useEffect, useMemo } from "react";

const KEYS = { arrowleft: "l", a: "l", arrowright: "r", d: "r", arrowup: "u", w: "u", arrowdown: "d", s: "d" };

/** Keyboard (WASD / arrows / space) + on-screen D-pad -> one movement vector. */
export function useInput() {
  const input = useMemo(() => {
    const keys = new Set();
    return {
      keys, pad: { x: 0, y: 0 }, onAttack: null,
      setPad(x, y) { this.pad = { x, y }; },
      vec() {
        const x = this.pad.x + (keys.has("r") ? 1 : 0) - (keys.has("l") ? 1 : 0);
        const y = this.pad.y + (keys.has("d") ? 1 : 0) - (keys.has("u") ? 1 : 0);
        return { x: Math.sign(x), y: Math.sign(y) };
      },
    };
  }, []);

  useEffect(() => {
    const down = (e) => {
      if (e.code === "Space") { e.preventDefault(); input.onAttack?.(); return; }
      const k = KEYS[e.key.toLowerCase()];
      if (k) { e.preventDefault(); input.keys.add(k); }
    };
    const up = (e) => { const k = KEYS[e.key.toLowerCase()]; if (k) input.keys.delete(k); };
    const clear = () => { input.keys.clear(); input.setPad(0, 0); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, [input]);

  return input;
}
