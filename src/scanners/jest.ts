import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import fs from 'fs';
import path from 'path';

export async function runJestCoverage(targetDir: string = '.', threshold: number = 80): Promise<ScannerResult> {
  const startTime = Date.now();
  const coverageFile = path.resolve(process.cwd(), targetDir, 'coverage', 'coverage-summary.json');
  
  try {
    // Run jest. Note: requires jest to be installed in the target repo.
    const result = await runCommand('npx', ['jest', '--coverage', '--coverageReporters=json-summary', '--passWithNoTests'], 120000, targetDir);
    const durationMs = Date.now() - startTime;

    if (!fs.existsSync(coverageFile)) {
      return {
        scannerName: 'Jest Coverage', success: false, durationMs, issues: [],
        error: `Coverage file not found. Ensure Jest is installed and configured in the project. Details: ${result.stderr.trim() || result.stdout.substring(0,100)}`
      };
    }

    const summary = JSON.parse(fs.readFileSync(coverageFile, 'utf8'));
    const issues: Issue[] = [];
    
    const totalLinesCov = summary.total?.lines?.pct ?? 0;
    
    if (totalLinesCov < threshold) {
       issues.push({
           id: 'LOW-TEST-COVERAGE',
           severity: 'HIGH',
           message: `Overall line coverage (${totalLinesCov}%) is below the required threshold (${threshold}%).`,
           source: 'Jest'
       });
     }

    // Check individual files
    for (const [file, metrics] of Object.entries(summary)) {
        if (file === 'total') continue;
        const fileCov: any = metrics;
        if (fileCov.lines.pct < threshold) {
           issues.push({
               id: 'FILE-LOW-COVERAGE',
               severity: 'MEDIUM',
               message: `File coverage (${fileCov.lines.pct}%) is below threshold.`,
               file: file.replace(process.cwd(), '').substring(1), // Make relative
               source: 'Jest'
           });
        }
    }

    return { scannerName: 'Jest Coverage', success: true, durationMs, issues };
  } catch (err) {
    return { scannerName: 'Jest Coverage', success: false, durationMs: Date.now() - startTime, issues: [], error: (err as Error).message };
  }
}

export const jestScanner: Scanner = {
  name: 'Jest Coverage',
  module: 'testing',
  supportedLanguages: ['node'],
  async run(ctx) {
    const dir = ctx.config.scanners.jest?.targetDir || '.';
    const thresh = ctx.config.scanners.jest?.threshold || 80;
    return runJestCoverage(dir, thresh);
  }
};
