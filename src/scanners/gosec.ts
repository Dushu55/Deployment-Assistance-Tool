import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';

export async function runGosec(targetDir: string = './...'): Promise<ScannerResult> {
  const startTime = Date.now();
  const issues: Issue[] = [];
  let durationMs = 0;

  try {
    // Run gosec
    const result = await runCommand('gosec', ['-fmt=json', targetDir], 120000);
    durationMs = Date.now() - startTime;

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return {
        scannerName: 'gosec',
        success: false,
        durationMs,
        issues: [],
        error: `gosec exited with code ${result.exitCode}. Details: ${result.stderr.trim() || result.stdout.trim()}`
      };
    }

    if (!result.stdout.trim()) {
       return { scannerName: 'gosec', success: true, durationMs, issues };
    }

    const parsedOutput = JSON.parse(result.stdout);

    if (parsedOutput.Issues && Array.isArray(parsedOutput.Issues)) {
      parsedOutput.Issues.forEach((r: any) => {
        issues.push({
          id: r.rule_id || 'gosec-finding',
          severity: mapSeverity(r.severity),
          message: r.details,
          file: r.file,
          line: parseInt(r.line, 10) || undefined,
          source: 'gosec'
        });
      });
    }

    return {
      scannerName: 'gosec',
      success: true,
      durationMs,
      issues
    };
  } catch (err: any) {
    return {
      scannerName: 'gosec',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: err.message
    };
  }
}

export const gosecScanner: Scanner = {
  name: 'gosec',
  module: 'static',
  supportedLanguages: ['go'],
  requiredBinaries: ['gosec'],
  async run(ctx) {
    const targetDir = (ctx.config.scanners as any).gosec?.targetDir || './...';
    return runGosec(targetDir);
  }
};
