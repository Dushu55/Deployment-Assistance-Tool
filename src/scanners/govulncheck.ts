import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';

export async function runGovulncheck(targetDir: string = './...'): Promise<ScannerResult> {
  const startTime = Date.now();
  const issues: Issue[] = [];
  let durationMs = 0;

  try {
    // Run govulncheck with JSON output
    // Note: govulncheck outputs a stream of JSON objects, not a single JSON array
    const result = await runCommand('govulncheck', ['-json', targetDir], 120000);
    durationMs = Date.now() - startTime;

    // govulncheck exits with 3 if issues are found. 
    if (result.exitCode !== 0 && result.exitCode !== 3) {
      return {
        scannerName: 'govulncheck',
        success: false,
        durationMs,
        issues: [],
        error: `govulncheck exited with code ${result.exitCode}. Details: ${result.stderr.trim() || result.stdout.trim()}`
      };
    }

    if (!result.stdout.trim()) {
       return { scannerName: 'govulncheck', success: true, durationMs, issues };
    }

    // Parse streaming JSON objects
    const lines = result.stdout.split('\n').filter(l => l.trim() !== '');
    
    for (const line of lines) {
        try {
            const parsed = JSON.parse(line);
            
            // "osv" object represents the vulnerability
            if (parsed.osv) {
                const v = parsed.osv;
                // Try to map severity, or default to HIGH
                let severityStr = 'HIGH';
                if (v.database_specific && v.database_specific.severity) {
                    severityStr = v.database_specific.severity;
                }

                // If govulncheck emits a finding, it already verifies call-graph reachability!
                // There is no need for our custom ReachabilityEngine here.
                issues.push({
                    id: v.id,
                    severity: mapSeverity(severityStr),
                    message: `${v.id} in ${v.affected?.[0]?.package?.name || 'unknown package'}: ${v.details || 'Known vulnerability'}`,
                    file: 'go.mod',
                    remediation: v.affected?.[0]?.ranges?.[0]?.events?.find((e: any) => e.fixed)?.fixed || 'Update module',
                    source: 'govulncheck'
                });
            }
        } catch (e) {
            // Ignore parse errors on individual lines if it's mixed with logs
        }
    }

    return {
      scannerName: 'govulncheck',
      success: true,
      durationMs,
      issues
    };
  } catch (err: any) {
    return {
      scannerName: 'govulncheck',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: err.message
    };
  }
}

export const govulncheckScanner: Scanner = {
  name: 'govulncheck',
  module: 'security',
  supportedLanguages: ['go'],
  requiredBinaries: ['govulncheck'],
  async run(ctx) {
    const targetDir = (ctx.config.scanners as any).govulncheck?.targetDir || './...';
    return runGovulncheck(targetDir);
  }
};
