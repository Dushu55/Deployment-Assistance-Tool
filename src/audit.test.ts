import test from 'node:test';
import assert from 'node:assert';
import { summarizeScannerMetrics } from './audit.js';
import { ScannerResult } from './types.js';

const r = (over: Partial<ScannerResult>): ScannerResult => ({
  scannerName: 'X', success: true, durationMs: 10, issues: [], ...over
});

test('summarizeScannerMetrics', async (t) => {
  const results: ScannerResult[] = [
    r({ scannerName: 'Semgrep', durationMs: 100, issues: [{ id: 'a', severity: 'HIGH', message: 'm', source: 'Semgrep' }] }),
    r({ scannerName: 'Trivy', success: false, durationMs: 50, error: 'boom' }),
    r({ scannerName: 'Dockle', skipped: true, success: true, durationMs: 0, skipReason: 'no docker' })
  ];
  const m = summarizeScannerMetrics(results);

  await t.test('counts run/failed/skipped correctly', () => {
    assert.strictEqual(m.scannersRun, 2);      // Semgrep + Trivy ran; Dockle skipped
    assert.strictEqual(m.scannersFailed, 1);   // Trivy
    assert.strictEqual(m.scannersSkipped, 1);  // Dockle
  });

  await t.test('carries per-scanner duration + issueCount', () => {
    const semgrep = m.scanners.find(s => s.name === 'Semgrep')!;
    assert.strictEqual(semgrep.durationMs, 100);
    assert.strictEqual(semgrep.issueCount, 1);
    const dockle = m.scanners.find(s => s.name === 'Dockle')!;
    assert.strictEqual(dockle.skipped, true);
  });
});
