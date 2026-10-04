import test from "node:test";
import assert from "node:assert/strict";
import { calculateDamage, deductHealth, resolveHit } from "../BackEnd/Game Engine/damage.ts";

test("a hit deducts floor(attack / defense) from existing health", () => {
    assert.deepEqual(resolveHit(100, 95, 30), { damage: 3, healthLost: 3, remainingHealth: 97, defeated: false });
    assert.equal(calculateDamage(90, 30), 3);
    assert.equal(resolveHit(97, 95, 30).remainingHealth, 94);
});

test("weaker attacks and zero attack cause zero damage", () => {
    assert.equal(calculateDamage(50, 65), 0);
    assert.equal(calculateDamage(0, 65), 0);
    assert.deepEqual(resolveHit(75, 50, 65), { damage: 0, healthLost: 0, remainingHealth: 75, defeated: false });
});

test("fatal and excessive damage stop health at zero", () => {
    assert.deepEqual(resolveHit(3, 95, 30), { damage: 3, healthLost: 3, remainingHealth: 0, defeated: true });
    assert.deepEqual(deductHealth(2, 10), { damage: 10, healthLost: 2, remainingHealth: 0, defeated: true });
    assert.deepEqual(deductHealth(0, 10), { damage: 10, healthLost: 0, remainingHealth: 0, defeated: true });
});

test("invalid stats cannot produce NaN, infinite damage, or healing", () => {
    for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => calculateDamage(value, 10), RangeError);
        assert.throws(() => calculateDamage(10, value), RangeError);
        assert.throws(() => deductHealth(value, 10), RangeError);
        assert.throws(() => deductHealth(10, value), RangeError);
    }
    assert.throws(() => calculateDamage(10, 0), RangeError);
});
