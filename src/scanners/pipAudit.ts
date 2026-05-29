import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';
import { ReachabilityEngine } from '../reachability/index.js';

export async function runPipAudit(targetFile: string = 'requirements.txt', detectedLanguages: string[] = ['python']): Promise<ScannerResult> {
  const startTime = Date.now();
  const issues: Issue[] = [];
  let durationMs = 0;
  const reachabilityEngine = new ReachabilityEngine(process.cwd(), detectedLanguages as any);

  try {
    // Run pip-audit against a requirements file
    const result = await runCommand('pip-audit', ['-r', targetFile, '-f', 'json'], 120000);
    durationMs = Date.now() - startTime;

    // pip-audit exits with 1 if vulnerabilities are found
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return {
        scannerName: 'pip-audit',
        success: false,
        durationMs,
        issues: [],
        error: `pip-audit exited with code ${result.exitCode}. Details: ${result.stderr.trim() || result.stdout.trim()}`
      };
    }

    if (!result.stdout.trim()) {
       return { scannerName: 'pip-audit', success: true, durationMs, issues };
    }

    const parsedOutput = JSON.parse(result.stdout);

    if (parsedOutput.dependencies && Array.isArray(parsedOutput.dependencies)) {
      const packageReachabilityCache = new Map<string, boolean>();

      for (const dep of parsedOutput.dependencies) {
        if (dep.vulns && dep.vulns.length > 0) {
          const packageName = dep.name;
          let isReachable = true;

          // Check reachability for the vulnerable python package
          if (packageName) {
            if (packageReachabilityCache.has(packageName)) {
              isReachable = packageReachabilityCache.get(packageName)!;
            } else {
              const reachability = await reachabilityEngine.checkPackage(packageName);
              isReachable = reachability.isReachable;
              packageReachabilityCache.set(packageName, isReachable);
            }
          }

          for (const vuln of dep.vulns) {
            let severity = mapSeverity(vuln.severity || 'HIGH'); // pip-audit usually provides CVSS or severity string
            let prefix = '';

            if (!isReachable) {
                severity = 'INFO';
                prefix = '[UNREACHABLE] ';
            }

            issues.push({
              id: vuln.id,
              severity,
              message: `${prefix}Package ${dep.name}@${dep.version} is vulnerable: ${vuln.fix_versions ? `Fixed in ${vuln.fix_versions.join(', ')}` : 'No known fix'}`,
              file: targetFile,
              source: 'pip-audit'
            });
          }
        }
      }
    }

    return {
      scannerName: 'pip-audit',
      success: true,
      durationMs,
      issues
    };
  } catch (err: any) {
    return {
      scannerName: 'pip-audit',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: err.message
    };
  }
}

export const pipAuditScanner: Scanner = {
  name: 'pip-audit',
  module: 'security',
  supportedLanguages: ['python'],
  requiredBinaries: ['pip-audit'],
  expectedInputs: [{ label: 'requirements.txt', category: 'lockfile', anyOf: ['requirements.txt'] }],
  async run(ctx) {
    const targetFile = (ctx.config.scanners as any).pipAudit?.targetFile || 'requirements.txt';
    return runPipAudit(targetFile, ctx.detectedLanguages);
  }
};
