# Game Engine

Put combat, movement, collision, pathfinding, and map simulation rules in this folder.
Keep HTTP handling in `BackEnd/Express/` and saved data in `BackEnd/Persistence Layer/`.

The first mechanic is a turn-based, one-on-one professor battle:

- Damage is `Math.floor(attacker.attack / defender.defense)`.
- Remaining health is `Math.max(0, currentHealth - damage)`.
- The faster professor acts first; speed ties give the player the first turn.
- Each attack changes turns. Zero health ends the battle and declares the other side the winner.
- Attack below defense can cause zero damage. If both professors cause zero damage, the battle starts as a draw.
- Each battle copies the roster stats into its own state. Level is recorded but does not change stats yet.

```typescript
import { createBattle, attack } from "./battle.ts";
import { PROFESSOR_POOL } from "../Professor Gacha System/Professor Pool/professors.ts";

let battle = createBattle(PROFESSOR_POOL[0], PROFESSOR_POOL[1]);
if (battle.nextTurn !== null) {
    const result = attack(battle, battle.nextTurn);
    battle = result.battle;
    console.log(result.event.damage, result.event.remainingHealth);
}
```

To use an owned professor, pass `{ ...inventoryItem.professor, level: inventoryItem.level }`.
The caller keeps the returned state; `attack` does not mutate the previous state or roster.

These are engine functions. Battle API routes, a battle page, teams, level-based stat scaling,
department advantages, movement, maps, and pathfinding have not been implemented yet.
