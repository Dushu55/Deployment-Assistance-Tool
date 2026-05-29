import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import fs from 'fs';
import path from 'path';

export async function runGitleaks(targetDir: string = '.'): Promise<ScannerResult> {
  const startTime = Date.now();
  const issues: Issue[] = [];
  let durationMs = 0;

  const reportName = `gitleaks-report-${Date.now()}.json`;
  const reportPath = path.resolve(process.cwd(), reportName);

  try {
    // Run Gitleaks. --no-git allows scanning directories without .git folder
    const result = await runCommand('gitleaks', ['detect', '--no-git', '-v', '-f', 'json', '-r', reportPath, '--source', targetDir], 120000);
    durationMs = Date.now() - startTime;

    // Exit code 0 = no leaks. Exit code 1 = leaks found. Others = fatal error.
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return {
        scannerName: 'Gitleaks (Secrets)',
        success: false,
        durationMs,
        issues: [],
        error: `Gitleaks exited with code ${result.exitCode}. Is it installed? Details: ${result.stderr.trim() || result.stdout.trim().substring(0, 100)}`
      };
    }

    if (!fs.existsSync(reportPath)) {
       // If no report is generated, assume no leaks
       return { scannerName: 'Gitleaks (Secrets)', success: true, durationMs, issues };
    }

    const fileContents = fs.readFileSync(reportPath, 'utf8');
    if (!fileContents.trim()) {
       fs.unlinkSync(reportPath);
       return { scannerName: 'Gitleaks (Secrets)', success: true, durationMs, issues };
    }

    const parsedOutput = JSON.parse(fileContents);

    if (Array.isArray(parsedOutput)) {
      parsedOutput.forEach((leak: any) => {
        issues.push({
          id: leak.RuleID || 'secret-leak',
          severity: 'CRITICAL', // Hardcoded secrets are always critical
          message: `Secret detected (${leak.Description || 'Unknown'}): ${leak.Secret ? 'REDACTED' : 'Hidden'}`,
          file: leak.File,
          line: leak.StartLine,
          source: 'Gitleaks'
        });
      });
    }

    fs.unlinkSync(reportPath);

    return {
      scannerName: 'Gitleaks (Secrets)',
      success: true,
      durationMs,
      issues
    };
  } catch (err: any) {
    if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
    return {
      scannerName: 'Gitleaks (Secrets)',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: err.message
    };
  }
}

export const gitleaksScanner: Scanner = {
  name: 'Gitleaks (Secrets)',
  module: 'security',
  supportedLanguages: 'all',
  requiredBinaries: ['gitleaks'],
  async run(ctx) {
    const targetDir = ctx.config.scanners.gitleaks?.targetDir || '.';
    return runGitleaks(targetDir);
  }
};
