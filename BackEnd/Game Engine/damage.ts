/** The result of one hit, including calculated damage and the health actually lost. */
export type DamageResult = {
    damage: number;
    healthLost: number;
    remainingHealth: number;
    defeated: boolean;
};

/**
 * Checks an integer used by the combat rules.
 * @param value - The health, damage, attack, or defense to check.
 * @param name - The field name for an error message.
 * @param minimum - The smallest allowed value.
 * @throws RangeError if the value is not a safe integer at or above the minimum.
 */
export function validateCombatValue(value: number, name: string, minimum = 0): void {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}.`);
    }
}

/**
 * Calculates damage using the attacker's attack and the defender's defense.
 * @param attack - The attacking professor's attack stat, at least zero.
 * @param defense - The defending professor's defense stat, greater than zero.
 * @returns Math.floor(attack / defense). A weaker attack can cause zero damage.
 * @throws RangeError for invalid stats, including zero defense.
 */
export function calculateDamage(attack: number, defense: number): number {
    validateCombatValue(attack, "Attack");
    validateCombatValue(defense, "Defense", 1);
    return Math.floor(attack / defense);
}

/**
 * Deducts a hit's damage from current health without letting health go below zero.
 * @param currentHealth - The defender's current health, at least zero.
 * @param damage - The calculated damage, at least zero.
 * @returns The damage, actual health lost, remaining health, and defeat status.
 * @throws RangeError for invalid health or damage values.
 */
export function deductHealth(currentHealth: number, damage: number): DamageResult {
    validateCombatValue(currentHealth, "Current health");
    validateCombatValue(damage, "Damage");
    const remainingHealth = Math.max(0, currentHealth - damage);
    return { damage, healthLost: currentHealth - remainingHealth, remainingHealth, defeated: remainingHealth === 0 };
}

/**
 * Resolves a hit using the configured attack/defense rule.
 * @param currentHealth - The defender's health before the hit.
 * @param attack - The attacker's attack stat.
 * @param defense - The defender's defense stat.
 * @returns The damage and health result of the hit.
 * @throws RangeError for invalid combat values.
 */
export function resolveHit(currentHealth: number, attack: number, defense: number): DamageResult {
    return deductHealth(currentHealth, calculateDamage(attack, defense));
}
