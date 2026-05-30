import test from 'node:test';
import assert from 'node:assert';
import { SEVERITY_EXPLANATIONS, CATEGORY_EXPLANATIONS, explainGate, buildGlossary } from './explain.js';
import { explainReadinessScore, calculateReadinessScore } from './utils.js';
import { Severity, FixCategory } from './types.js';

test('glossary completeness', async (t) => {
  await t.test('every Severity has an explanation', () => {
    (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as Severity[]).forEach(s => {
      assert.ok(SEVERITY_EXPLANATIONS[s]?.meaning, `missing severity ${s}`);
    });
  });
  await t.test('every FixCategory has an explanation', () => {
    (['security', 'defect', 'best-practice', 'robustness', 'coherence', 'fail-safe', 'coverage'] as FixCategory[]).forEach(c => {
      assert.ok(CATEGORY_EXPLANATIONS[c]?.whyItMatters, `missing category ${c}`);
    });
  });
});

test('explainReadinessScore', async (t) => {
  await t.test('penalties sum to (100 - score) when not clamped', () => {
    const summary = { critical: 0, high: 1, medium: 1, low: 0, info: 0 }; // 25 + 8 = 33 penalty -> score 67
    const e = explainReadinessScore(summary);
    assert.strictEqual(e.score, calculateReadinessScore(summary));
    assert.ok(e.score > 0 && e.score < 100, 'precondition: score not clamped');
    assert.ok(Math.abs(e.totalPenalty - (100 - e.score)) <= 1, `penalty ${e.totalPenalty} vs 100-${e.score}`);
  });
  await t.test('clean report is green at 100 with zero penalty', () => {
    const e = explainReadinessScore({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
    assert.strictEqual(e.score, 100);
    assert.strictEqual(e.band, 'green');
    assert.strictEqual(e.totalPenalty, 0);
  });
  await t.test('a critical drives the band red', () => {
    assert.strictEqual(explainReadinessScore({ critical: 2, high: 0, medium: 0, low: 0 }).band, 'red');
  });
});

test('explainGate', async (t) => {
  await t.test('passes with no blocking-severity findings', () => {
    const g = explainGate(['CRITICAL', 'HIGH'], { critical: 0, high: 0, medium: 3, low: 1 });
    assert.strictEqual(g.passed, true);
    assert.strictEqual(g.blockingSeverities.length, 0);
  });
  await t.test('fails and reports the blocking severities', () => {
    const g = explainGate(['CRITICAL', 'HIGH'], { critical: 0, high: 2, medium: 0, low: 0 });
    assert.strictEqual(g.passed, false);
    assert.deepStrictEqual(g.blockingSeverities, [{ severity: 'HIGH', count: 2 }]);
    assert.match(g.rationale, /2 HIGH/);
  });
});

test('buildGlossary aggregates everything', () => {
  const g = buildGlossary({ critical: 1, high: 0, medium: 0, low: 0, info: 0 });
  assert.ok(Array.isArray(g.howItWorks) && g.howItWorks.length > 0);
  assert.ok(g.score.thisReport.score < 100);
  assert.ok(g.severities.CRITICAL && g.categories.security && g.gate && g.readinessLevels);
});
