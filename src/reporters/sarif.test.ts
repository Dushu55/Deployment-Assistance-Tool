import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { generateSarif } from './sarif.js';
import { AggregatedReport } from '../types.js';

test('SARIF Reporter Component', async (t) => {
  await t.test('should generate valid SARIF 2.1.0 structure', () => {
     const mockReport: AggregatedReport = {
        timestamp: new Date().toISOString(),
        totalDurationMs: 100,
        summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
        results: [{
           scannerName: 'Semgrep', success: true, durationMs: 10,
           issues: [{
              id: 'vuln-1', severity: 'HIGH', source: 'Semgrep',
              message: 'Bad code', file: 'app.js', line: 10
           }]
        }]
     };

     const outPath = 'results/.test-report.sarif';
     generateSarif(mockReport, outPath);
     const content = JSON.parse(fs.readFileSync(outPath, 'utf8'));
     fs.unlinkSync(outPath);
     
     assert.strictEqual(content.version, '2.1.0');
     assert.strictEqual(content.runs[0].tool.driver.name, 'Deployment Assist Tool (DAT)');
     assert.strictEqual(content.runs[0].results[0].ruleId, 'Semgrep-vuln-1');
     assert.strictEqual(content.runs[0].results[0].level, 'error'); // HIGH maps to error
     assert.strictEqual(content.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, 'app.js');
  });
});
