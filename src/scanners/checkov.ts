import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';

export async function runCheckov(targetDir: string = '.'): Promise<ScannerResult> {
  const startTime = Date.now();
  try {
    const result = await runCommand('checkov', ['-d', targetDir, '-o', 'json', '--quiet'], 300000);
    const durationMs = Date.now() - startTime;

    // Checkov returns a non-zero exit code if vulnerabilities are found
    if (!result.stdout.trim()) {
        if (result.exitCode !== 0 && result.exitCode !== 1) {
            return {
                scannerName: 'Checkov', success: false, durationMs, issues: [],
                error: `Checkov failed: ${result.stderr.trim()}`
            };
        }
        return { scannerName: 'Checkov', success: true, durationMs, issues: [] };
    }

    let parsedOutput;
    try {
      parsedOutput = JSON.parse(result.stdout);
    } catch (e) {
      return { scannerName: 'Checkov', success: false, durationMs, issues: [], error: `JSON Parse error: ${e}` };
    }

    const issues: Issue[] = [];
    // Checkov can return an array (multiple frameworks) or an object (single framework)
    const reports = Array.isArray(parsedOutput) ? parsedOutput : [parsedOutput];

    reports.forEach(report => {
      if (report.results && report.results.failed_checks) {
        report.results.failed_checks.forEach((check: any) => {
          // Parse actual Checkov severity if it exists, otherwise default to HIGH
          const checkSeverity = check.severity ? mapSeverity(check.severity) : 'HIGH';
          issues.push({
            id: check.check_id,
            severity: checkSeverity,
            message: check.check_name,
            file: check.file_path,
            line: check.file_line_range ? check.file_line_range[0] : undefined,
            source: `Checkov (${report.check_type})`
          });
        });
      }
    });

    return { scannerName: 'Checkov', success: true, durationMs, issues };
  } catch (err) {
     return { scannerName: 'Checkov', success: false, durationMs: Date.now() - startTime, issues: [], error: (err as Error).message };
  }
}

export const checkovScanner: Scanner = {
  name: 'Checkov',
  module: 'security',
  supportedLanguages: 'all',
  requiredBinaries: ['checkov'],
  expectedInputs: [{ label: 'IaC files (Terraform/Dockerfile)', category: 'iac', anyOf: ['Dockerfile'], anyExtRecursive: ['.tf'] }],
  async run(ctx) {
    const targetDir = ctx.config.scanners.checkov?.targetDir || '.';
    return runCheckov(targetDir);
  }
};
