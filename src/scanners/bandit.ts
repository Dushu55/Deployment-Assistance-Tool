import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';

export async function runBandit(targetDir: string = '.'): Promise<ScannerResult> {
  const startTime = Date.now();
  const issues: Issue[] = [];
  let durationMs = 0;

  try {
    // Run Bandit recursively (-r) and output in JSON format (-f json)
    const result = await runCommand('bandit', ['-r', targetDir, '-f', 'json'], 120000);
    durationMs = Date.now() - startTime;

    // Bandit exits with 1 if issues are found, 2 if there's a usage error.
    // We only fail the scanner if it's a hard crash (not just finding vulnerabilities).
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return {
        scannerName: 'Bandit',
        success: false,
        durationMs,
        issues: [],
        error: `Bandit exited with code ${result.exitCode}. Details: ${result.stderr.trim() || result.stdout.trim()}`
      };
    }

    // If there is no output but exit code is 0, it means no issues and no json.
    if (!result.stdout.trim()) {
       return { scannerName: 'Bandit', success: true, durationMs, issues };
    }

    const parsedOutput = JSON.parse(result.stdout);

    if (parsedOutput.results && Array.isArray(parsedOutput.results)) {
      parsedOutput.results.forEach((r: any) => {
        issues.push({
          id: r.test_id || 'bandit-finding',
          severity: mapSeverity(r.issue_severity),
          message: r.issue_text,
          file: r.filename,
          line: r.line_number,
          source: 'Bandit'
        });
      });
    }

    return {
      scannerName: 'Bandit',
      success: true,
      durationMs,
      issues
    };
  } catch (err: any) {
    return {
      scannerName: 'Bandit',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: err.message
    };
  }
}

export const banditScanner: Scanner = {
  name: 'Bandit',
  module: 'static',
  supportedLanguages: ['python'],
  requiredBinaries: ['bandit'],
  async run(ctx) {
    const targetDir = (ctx.config.scanners as any).bandit?.targetDir || '.';
    return runBandit(targetDir);
  }
};
