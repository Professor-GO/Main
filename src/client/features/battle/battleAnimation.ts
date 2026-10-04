import type { BattleView } from "../world/battleApi";
export type BattleBeat =
  | "playerAttack"
  | "enemyAttack"
  | "enemyHit"
  | "playerHit"
  | "heal"
  | "won"
  | "lost"
  | "fled";

/** Translates new authoritative combat results into presentation beats; question reads and retries do not replay hits. */
export function battleBeats(
  before: BattleView | null,
  after: BattleView,
): BattleBeat[] {
  if (before && before.id === after.id && before.version >= after.version)
    return [];
  const beats: BattleBeat[] = [];
  if (before && before.id === after.id && after.status !== "fled") {
    const playerDamage =
      before.status === "question" ? (after.feedback?.playerDamage ?? 0) : 0;
    if (before.status === "fighting") beats.push("playerAttack");
    else if (before.status === "question") {
      const healed = after.feedback?.healed ?? 0;
      if (healed > 0) beats.push("heal");
      if (playerDamage > 0) beats.push("playerHit");
      if (before.health + healed > after.health) beats.push("enemyHit");
    }
    if (before.playerHealth - playerDamage > after.playerHealth)
      beats.push("enemyAttack");
  }
  if (
    after.status === "won" ||
    after.status === "lost" ||
    after.status === "fled"
  )
    beats.push(after.status);
  return beats;
}
