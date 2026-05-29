import fs from 'fs';
import path from 'path';
import { AggregatedReport, Severity } from '../types.js';

function getSarifLevel(severity: Severity): string {
  switch (severity) {
    case 'CRITICAL':
    case 'HIGH':
      return 'error';
    case 'MEDIUM':
      return 'warning';
    case 'LOW':
    case 'INFO':
    default:
      return 'note';
  }
}

export function generateSarif(report: AggregatedReport, outputPath: string = 'dat-report.sarif'): void {
  const rules = new Map<string, any>();
  const results: any[] = [];

  report.results.forEach(scanner => {
    scanner.issues.forEach(issue => {
      // Register rule to comply with SARIF standard
      const ruleId = `${scanner.scannerName}-${issue.id}`.replace(/[^a-zA-Z0-9.-]/g, '_');
      if (!rules.has(ruleId)) {
        rules.set(ruleId, {
          id: ruleId,
          shortDescription: { text: issue.message.substring(0, 100) },
          fullDescription: { text: issue.message },
          help: { text: issue.remediation || 'No remediation provided.' }
        });
      }

      // Create finding result
      results.push({
        ruleId: ruleId,
        level: getSarifLevel(issue.severity),
        message: { text: `[${issue.severity}] ${issue.message}` },
        locations: [
          {
            physicalLocation: {
              artifactLocation: {
                uri: issue.file || 'unknown-file',
              },
              region: {
                startLine: issue.line || 1,
              }
            }
          }
        ]
      });
    });
  });

  const sarifDocument = {
    version: '2.1.0',
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: 'Deployment Assist Tool (DAT)',
            informationUri: 'https://github.com/quantiphi/dat',
            rules: Array.from(rules.values())
          }
        },
        results: results
      }
    ]
  };

  const fullPath = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(sarifDocument, null, 2));
}
