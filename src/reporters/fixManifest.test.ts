import test from 'node:test';
import assert from 'node:assert';
import { buildFixManifest, FIX_MANIFEST_SCHEMA_VERSION } from './fixManifest.js';
import { AggregatedReport } from '../types.js';

function makeReport(): AggregatedReport {
  return {
    timestamp: '2026-05-30T00:00:00.000Z',
    totalDurationMs: 1000,
    summary: { critical: 1, high: 1, medium: 1, low: 0, info: 1 },
    results: [
      { scannerName: 'Semgrep', success: true, durationMs: 10, issues: [
        { id: 'rules.eval', severity: 'CRITICAL', message: 'Avoid eval', file: 'src/a.ts', line: 4, remediation: 'remove eval', source: 'Semgrep' },
        { id: 'rules.note', severity: 'INFO', message: 'fyi', source: 'Semgrep' }
      ]},
      { scannerName: 'Logic Tests', success: true, durationMs: 20, issues: [
        { id: 'TEST-FAILURE', severity: 'HIGH', message: 'login test failed', file: 'src/login.test.ts', line: 12, source: 'Logic Tests' }
      ]},
      { scannerName: 'Hadolint', success: true, durationMs: 5, issues: [
        { id: 'DL3008', severity: 'MEDIUM', message: 'Pin apt versions', file: 'Dockerfile', line: 2, source: 'Hadolint' }
      ]},
      { scannerName: 'Trivy', success: true, skipped: true, skipReason: 'Required tool(s) not found on PATH: trivy', durationMs: 0, issues: [] }
    ]
  };
}

test('buildFixManifest', async (t) => {
  const manifest = buildFixManifest(makeReport(), {
    verifyCommand: 'npm test', failOn: ['CRITICAL', 'HIGH'], readinessScore: 42, gatePassed: false
  });

  await t.test('carries schema version and gate metadata', () => {
    assert.strictEqual(manifest.schemaVersion, FIX_MANIFEST_SCHEMA_VERSION);
    assert.strictEqual(manifest.gate.readinessScore, 42);
    assert.strictEqual(manifest.gate.passed, false);
    assert.deepStrictEqual(manifest.gate.failOn, ['CRITICAL', 'HIGH']);
  });

  await t.test('excludes INFO findings (not actionable)', () => {
    assert.ok(!manifest.findings.some(f => f.title === 'rules.note'));
    assert.strictEqual(manifest.findings.length, 3);
  });

  await t.test('marks gate-blocking findings and orders them first', () => {
    assert.strictEqual(manifest.findings[0].gateBlocking, true);
    assert.strictEqual(manifest.findings[0].severity, 'CRITICAL');
    const medium = manifest.findings.find(f => f.severity === 'MEDIUM');
    assert.strictEqual(medium!.gateBlocking, false);
  });

  await t.test('assigns categories from the scanner taxonomy', () => {
    assert.strictEqual(manifest.findings.find(f => f.source === 'Semgrep')!.category, 'security');
    assert.strictEqual(manifest.findings.find(f => f.title === 'TEST-FAILURE')!.category, 'defect');
    assert.strictEqual(manifest.findings.find(f => f.source === 'Hadolint')!.category, 'best-practice');
  });

  await t.test('threads the verification command and suggested fix through', () => {
    const evalFinding = manifest.findings.find(f => f.title === 'rules.eval')!;
    assert.strictEqual(evalFinding.verification.command, 'npm test');
    assert.strictEqual(evalFinding.suggestedFix, 'remove eval');
    assert.strictEqual(evalFinding.location.file, 'src/a.ts');
    assert.strictEqual(evalFinding.location.startLine, 4);
  });

  await t.test('records skipped scanners AND not-run security dimensions as honest coverage gaps', () => {
    const names = manifest.coverageGaps.map(g => g.scanner);
    assert.ok(names.includes('Trivy'), 'skipped Trivy recorded');
    assert.ok(names.includes('OWASP ZAP'), 'DAST gap recorded (was not run)');
    assert.ok(names.includes('Gitleaks (Secrets)'), 'secret-scan gap recorded (was not run)');
  });

  await t.test('varies confidence: deterministic high, heuristic component-eval medium, coherence low', () => {
    const report = makeReport();
    report.results.push({ scannerName: 'Component Evaluator', success: true, durationMs: 1, issues: [
      { id: 'COMP-APICALL-NO-TIMEOUT', severity: 'MEDIUM', message: 'no timeout', file: 'a.tsx', line: 3, source: 'Component Evaluator', category: 'robustness' },
      { id: 'COMP-CROSSSTACK-AUTH-MISMATCH', severity: 'MEDIUM', message: 'mismatch', file: 'b.tsx', line: 4, source: 'Component Evaluator', category: 'coherence' },
    ]});
    const m = buildFixManifest(report, { verifyCommand: 'npm test', failOn: ['CRITICAL', 'HIGH'] });
    assert.strictEqual(m.findings.find(f => f.title === 'rules.eval')!.confidence, 'high');
    assert.strictEqual(m.findings.find(f => f.title === 'COMP-APICALL-NO-TIMEOUT')!.confidence, 'medium');
    assert.strictEqual(m.findings.find(f => f.title === 'COMP-CROSSSTACK-AUTH-MISMATCH')!.confidence, 'low');
  });

  await t.test('raises falsePositiveLikelihood for findings in test files', () => {
    const f = manifest.findings.find(f => f.title === 'TEST-FAILURE')!; // src/login.test.ts
    assert.strictEqual(f.falsePositiveLikelihood, 'high');
    assert.strictEqual(manifest.findings.find(f => f.title === 'rules.eval')!.falsePositiveLikelihood, 'low'); // src/a.ts
  });

  await t.test('groups repeated rules so they can be batch-fixed', () => {
    const report = makeReport();
    report.results.push({ scannerName: 'SonarQube', success: true, durationMs: 1, issues: [
      { id: 'typescript:S7764', severity: 'LOW', message: 'prefer globalThis', file: 'a.ts', line: 1, source: 'SonarQube', category: 'best-practice' },
      { id: 'typescript:S7764', severity: 'LOW', message: 'prefer globalThis', file: 'b.ts', line: 2, source: 'SonarQube', category: 'best-practice' },
    ]});
    const m = buildFixManifest(report, {});
    const grp = m.groups.find(g => g.key === 'typescript:S7764')!;
    assert.ok(grp); assert.strictEqual(grp.count, 2);
  });
});
