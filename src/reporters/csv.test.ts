import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { generateCsv } from './csv.js';
import { AggregatedReport } from '../types.js';

test('CSV Reporter Component', async (t) => {
  await t.test('should correctly flatten data and escape commas/quotes', () => {
     const mockReport: AggregatedReport = {
        timestamp: new Date().toISOString(),
        totalDurationMs: 100,
        summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
        results: [{
           scannerName: 'TestScanner', success: true, durationMs: 10,
           issues: [{
              id: 'RULE-1', severity: 'CRITICAL', source: 'Test',
              message: 'Message with, a comma and "quotes"',
              file: 'index.js',
              line: 42
           }]
        }]
     };
     
     const outPath = 'results/.test-report.csv';
     generateCsv(mockReport, outPath);
     const content = fs.readFileSync(outPath, 'utf8');
     fs.unlinkSync(outPath);
     
     // Assert the escaped string exists in the CSV
     assert.match(content, /"Message with, a comma and ""quotes"""/);
     // Assert headers
     assert.match(content, /Scanner,ID,Severity,Message,File,Line,Remediation/);
  });
});
