import fs from 'fs';
import path from 'path';
import { AggregatedReport } from '../types.js';

function escapeCsv(value: string | number | undefined): string {
  if (value === undefined || value === null) return '';
  const str = String(value).replace(/"/g, '""'); // Escape double quotes for CSV
  // Wrap in double quotes if the value contains a comma, newline, or double quote
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str}"`;
  }
  return str;
}

export function generateCsv(report: AggregatedReport, outputPath: string = 'dat-report.csv'): void {
  const headers = ['Scanner', 'ID', 'Severity', 'Message', 'File', 'Line', 'Remediation'];
  const rows: string[] = [headers.join(',')];

  report.results.forEach(scanner => {
    scanner.issues.forEach(issue => {
      const row = [
        escapeCsv(scanner.scannerName),
        escapeCsv(issue.id),
        escapeCsv(issue.severity),
        escapeCsv(issue.message),
        escapeCsv(issue.file),
        escapeCsv(issue.line),
        escapeCsv(issue.remediation)
      ];
      rows.push(row.join(','));
    });
  });

  const fullPath = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, rows.join('\n'), 'utf8');
}
