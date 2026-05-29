import test from 'node:test';
import assert from 'node:assert';
import { mapSeverity, calculateReadinessScore } from './utils.js';

test('mapSeverity', async (t) => {
  await t.test('maps known severities', () => {
    assert.strictEqual(mapSeverity('critical'), 'CRITICAL');
    assert.strictEqual(mapSeverity('FATAL'), 'CRITICAL');
    assert.strictEqual(mapSeverity('High'), 'HIGH');
    assert.strictEqual(mapSeverity('error'), 'HIGH');
    assert.strictEqual(mapSeverity('warning'), 'MEDIUM');
    assert.strictEqual(mapSeverity('low'), 'LOW');
    assert.strictEqual(mapSeverity('informational'), 'LOW');
  });

  await t.test('fail-safes unknown severities to HIGH (never silently demote)', () => {
    assert.strictEqual(mapSeverity('some-novel-blocker-level'), 'HIGH');
    assert.strictEqual(mapSeverity('xyz'), 'HIGH');
  });

  await t.test('handles empty/whitespace and multi-word risk strings', () => {
    assert.strictEqual(mapSeverity(''), 'INFO');
    assert.strictEqual(mapSeverity('High (Medium confidence)'), 'HIGH');
  });
});

test('calculateReadinessScore', async (t) => {
  const empty = { critical: 0, high: 0, medium: 0, low: 0 };

  await t.test('a clean report scores 100', () => {
    assert.strictEqual(calculateReadinessScore(empty), 100);
  });

  await t.test('is bounded to [0,100]', () => {
    const score = calculateReadinessScore({ critical: 50, high: 50, medium: 50, low: 50 });
    assert.ok(score >= 0 && score <= 100, `score ${score} out of range`);
    assert.strictEqual(score, 0);
  });

  await t.test('severity dominates volume: one CRITICAL is worse than many LOWs', () => {
    const oneCritical = calculateReadinessScore({ ...empty, critical: 1 });
    const manyLows = calculateReadinessScore({ ...empty, low: 30 });
    assert.ok(oneCritical < manyLows, `expected 1 critical (${oneCritical}) < 30 lows (${manyLows})`);
  });

  await t.test('diminishing returns: 10 lows do not score 10x worse than 1 low', () => {
    const one = 100 - calculateReadinessScore({ ...empty, low: 1 });
    const ten = 100 - calculateReadinessScore({ ...empty, low: 10 });
    assert.ok(ten < one * 10, `expected dampening: 10-low penalty ${ten} < 10x 1-low penalty ${one * 10}`);
  });

  await t.test('is monotonic — more findings never raise the score', () => {
    const base = calculateReadinessScore({ ...empty, high: 1 });
    const more = calculateReadinessScore({ ...empty, high: 2 });
    assert.ok(more <= base);
  });
});
