import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner, Severity } from '../types.js';
import { mapSeverity } from '../utils.js';
import fs from 'fs';
import path from 'path';

// Local override for Semgrep where ERROR is mapped to CRITICAL, WARNING to MEDIUM, etc.
function mapSemgrepSeverity(semgrepSeverity: string): Severity {
  switch (semgrepSeverity.toUpperCase()) {
    case 'ERROR': return 'CRITICAL';
    case 'WARNING': return 'HIGH';
    case 'INFO': return 'INFO';
    default: return 'HIGH';
  }
}

// Pure parser for Semgrep's --json output, extracted for unit testing.
export function parseSemgrepResults(parsedOutput: any): Issue[] {
  return (parsedOutput?.results || []).map((r: any) => ({
    id: r.check_id,
    severity: mapSemgrepSeverity(r.extra?.severity || 'INFO'),
    message: r.extra?.message || 'No message provided',
    file: r.path,
    line: r.start?.line,
    remediation: r.extra?.fix || r.extra?.metadata?.remediation,
    source: 'Semgrep'
  }));
}

export async function runSemgrep(rules: string[] = ['p/security-audit'], customRulesDir: string = 'rules', excludes: string[] = []): Promise<ScannerResult> {
  const startTime = Date.now();
  try {
    // Build command arguments
    const args = ['scan', '--json'];
    rules.forEach(rule => {
      args.push('--config', rule);
    });

    // Add custom rules directory if it exists
    const customPath = path.resolve(process.cwd(), customRulesDir);
    if (fs.existsSync(customPath)) {
      args.push('--config', customPath);
    }

    // Honor the config `exclude` globs so Semgrep doesn't even scan excluded trees.
    excludes.forEach(pattern => {
      args.push('--exclude', pattern);
    });

    // Scan current directory
    args.push('.');

    const result = await runCommand('semgrep', args, 120000); // 2 min timeout
    const durationMs = Date.now() - startTime;

    // Semgrep exits with 1 if issues are found, 0 if clean.
    // Other exit codes indicate execution errors.
    if (result.exitCode !== 0 && result.exitCode !== 1) {
        return {
            scannerName: 'Semgrep',
            success: false,
            durationMs,
            issues: [],
            error: `Semgrep exited with code ${result.exitCode}. Is it installed? Details: ${result.stderr.trim()}`
        };
    }

    // Parse the JSON output
    let parsedOutput;
    try {
      parsedOutput = JSON.parse(result.stdout);
    } catch (e) {
      return {
        scannerName: 'Semgrep',
        success: false,
        durationMs,
        issues: [],
        error: `Failed to parse Semgrep JSON output. stdout: ${result.stdout.substring(0, 100)}...`
      };
    }

    const issues: Issue[] = parseSemgrepResults(parsedOutput);

    return {
      scannerName: 'Semgrep',
      success: true,
      durationMs,
      issues
    };

  } catch (err) {
    return {
      scannerName: 'Semgrep',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: (err as Error).message
    };
  }
}

export const semgrepScanner: Scanner = {
  name: 'Semgrep',
  module: 'static',
  supportedLanguages: 'all',
  requiredBinaries: ['semgrep'],
  async run(ctx) {
    const rules = ctx.config.scanners.semgrep?.rules || ['p/security-audit'];
    const customRulesDir = ctx.config.scanners.semgrep?.customRulesDir || 'rules';
    return runSemgrep(rules, customRulesDir, ctx.config.exclude ?? []);
  }
};
