import test from 'node:test';
import assert from 'node:assert';
import { renderReportHtml } from './html.js';
import { AggregatedReport } from '../types.js';

function sampleReport(): AggregatedReport {
  return {
    timestamp: '2026-05-30T00:00:00.000Z',
    totalDurationMs: 1234,
    summary: { critical: 0, high: 1, medium: 1, low: 0, info: 0 },
    results: [
      { scannerName: 'Component Evaluator', success: true, durationMs: 5, issues: [
        { id: 'COMP-ENDPOINT-NOAUTH', severity: 'HIGH', message: 'State-changing endpoint POST /api/x has no auth.', file: 'server.ts', line: 2, remediation: 'Add auth middleware.', source: 'Component Evaluator', category: 'security' }
      ]},
      { scannerName: 'Trivy', success: true, skipped: true, skipReason: 'Required tool(s) not found on PATH: trivy', durationMs: 0, issues: [] }
    ]
  };
}

test('renderReportHtml', async (t) => {
  const html = renderReportHtml({ report: sampleReport(), score: 67, failOn: ['CRITICAL', 'HIGH'], readinessLevel: 'not-production-safe' });

  await t.test('includes the how-to-read glossary section', () => {
    assert.match(html, /How to read this report/);
    assert.match(html, /How DAT works/);
    assert.match(html, /What the severities mean/);
    assert.match(html, /What the finding categories mean/);
  });

  await t.test('renders the gate banner (failed) with rationale', () => {
    assert.match(html, /Quality Gate FAILED/);
    assert.match(html, /1 HIGH/); // rationale cites the blocking finding
  });

  await t.test('shows the dynamic score breakdown', () => {
    assert.match(html, /How this score was calculated/);
    assert.match(html, /Total penalty/);
    assert.match(html, /67\/100/);
  });

  await t.test('per-finding category + why-it-matters', () => {
    assert.match(html, /COMP-ENDPOINT-NOAUTH/);
    assert.match(html, /Why it matters/);
    assert.match(html, /Security/); // category label
  });

  await t.test('coverage section lists skipped scanners', () => {
    assert.match(html, /Coverage gaps/);
    assert.match(html, /Trivy/);
  });

  await t.test('shows the readiness level when provided', () => {
    assert.match(html, /NOT PRODUCTION-SAFE/);
  });
});
