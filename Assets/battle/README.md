# Battle artwork

The fourteen transparent WebP head cutouts in `heads/` were extracted from the user-provided `Assets/stickman-react.zip`. The original archive is preserved.

The archive's articulated SVG rig, joint coordinates, portrait proportions, and GSAP idle, attack, hit, wave, and walking motions were adapted into typed components under `src/client/features/battle/`. Both combatants use the full rig. The demo's local HP deductions and automatic enemy respawn were replaced with presentation driven by the existing server battle state.

Vite imports only the head cutouts for publication. The original archive and its demo application are not served to players.
