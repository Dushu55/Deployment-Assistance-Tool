import test from 'node:test';
import assert from 'node:assert';
import { mapSeverity, calculateReadinessScore, deduplicateResults, issueFingerprint } from './utils.js';
import { ScannerResult } from './types.js';

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

test('issueFingerprint', async (t) => {
  await t.test('normalises leading ./ so prefixed and bare paths collapse', () => {
    assert.strictEqual(
      issueFingerprint({ id: 'CVE-1', file: './src/a.ts', line: 5 }),
      issueFingerprint({ id: 'CVE-1', file: 'src/a.ts', line: 5 })
    );
  });

  await t.test('uses "global" for fileless findings', () => {
    assert.strictEqual(issueFingerprint({ id: 'X' }), 'X::global');
  });
});

test('deduplicateResults', async (t) => {
  const mk = (name: string, issues: any[]): ScannerResult => ({
    scannerName: name, success: true, durationMs: 1, issues
  });

  await t.test('drops the same CVE reported by two scanners (first wins)', () => {
    const results = [
      mk('Trivy', [{ id: 'CVE-2024-1', severity: 'HIGH', message: 'a', file: 'pkg.json', source: 'Trivy' }]),
      mk('OSV', [{ id: 'CVE-2024-1', severity: 'HIGH', message: 'a', file: 'pkg.json', source: 'OSV' }])
    ];
    const deduped = deduplicateResults(results);
    assert.strictEqual(deduped[0].issues.length, 1);
    assert.strictEqual(deduped[1].issues.length, 0);
  });

  await t.test('keeps distinct findings (different line or id)', () => {
    const results = [
      mk('Semgrep', [
        { id: 'rule-a', severity: 'HIGH', message: 'm', file: 'x.ts', line: 1, source: 'Semgrep' },
        { id: 'rule-a', severity: 'HIGH', message: 'm', file: 'x.ts', line: 2, source: 'Semgrep' },
        { id: 'rule-b', severity: 'LOW', message: 'm', file: 'x.ts', line: 1, source: 'Semgrep' }
      ])
    ];
    assert.strictEqual(deduplicateResults(results)[0].issues.length, 3);
  });

  await t.test('does not mutate the input', () => {
    const results = [mk('A', [{ id: 'd', severity: 'LOW', message: 'm', source: 'A' }, { id: 'd', severity: 'LOW', message: 'm', source: 'A' }])];
    deduplicateResults(results);
    assert.strictEqual(results[0].issues.length, 2, 'original results should be untouched');
  });
});
