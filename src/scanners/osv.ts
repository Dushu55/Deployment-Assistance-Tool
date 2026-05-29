import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';
import { ReachabilityEngine } from '../reachability/index.js';

export async function runOsvScanner(targetDir: string = '.', detectedLanguages: string[] = ['node']): Promise<ScannerResult> {
  const startTime = Date.now();
  const reachabilityEngine = new ReachabilityEngine(process.cwd(), detectedLanguages as any);

  try {
    const result = await runCommand('osv-scanner', ['scan', 'source', '-r', '--format', 'json', targetDir], 300000);
    const durationMs = Date.now() - startTime;

    let parsedOutput;
    try {
      parsedOutput = JSON.parse(result.stdout);
    } catch (e) {
       if (result.exitCode !== 0 && result.exitCode !== 1) {
          return { scannerName: 'OSV-Scanner', success: false, durationMs, issues: [], error: `OSV-Scanner failed: ${result.stderr.trim() || result.stdout.trim()}` };
       }
       return { scannerName: 'OSV-Scanner', success: true, durationMs, issues: [] };
    }

    const issues: Issue[] = [];
    
    if (parsedOutput.results) {
      for (const res of parsedOutput.results) {
        const sourceFile = res.source?.path || 'unknown';
        if (res.packages) {
          const packageReachabilityCache = new Map<string, boolean>();

          for (const pkg of res.packages) {
            if (pkg.vulnerabilities) {
              const packageName = pkg.package?.name;
              let isReachable = true;

              if (packageName) {
                  if (packageReachabilityCache.has(packageName)) {
                      isReachable = packageReachabilityCache.get(packageName)!;
                  } else {
                      const reachability = await reachabilityEngine.checkNodePackage(packageName);
                      isReachable = reachability.isReachable;
                      packageReachabilityCache.set(packageName, isReachable);
                  }
              }

              for (const vuln of pkg.vulnerabilities) {
                // Try to extract actual severity from database_specific or severity array
                let severityStr = 'HIGH';
                if (vuln.database_specific?.severity) {
                  severityStr = vuln.database_specific.severity;
                } else if (Array.isArray(vuln.severity) && vuln.severity.length > 0) {
                  // Find the score or mapping
                  severityStr = vuln.severity[0].score || 'HIGH';
                }

                let severity = mapSeverity(severityStr);
                let prefix = '';

                if (!isReachable) {
                    severity = 'INFO';
                    prefix = '[UNREACHABLE] ';
                }

                issues.push({
                  id: vuln.id,
                  severity,
                  message: `${prefix}Package ${pkg.package?.name}@${pkg.package?.version} is vulnerable: ${vuln.summary || 'Known vulnerability'}`,
                  file: sourceFile,
                  source: 'OSV-Scanner'
                });
              }
            }
          }
        }
      }
    }

    return { scannerName: 'OSV-Scanner', success: true, durationMs, issues };
  } catch (err) {
     return { scannerName: 'OSV-Scanner', success: false, durationMs: Date.now() - startTime, issues: [], error: (err as Error).message };
  }
}

export const osvScanner: Scanner = {
  name: 'OSV-Scanner',
  module: 'security',
  supportedLanguages: 'all',
  requiredBinaries: ['osv-scanner'],
  expectedInputs: [{ label: 'Dependency manifest', category: 'deps', anyOf: ['package.json', 'requirements.txt', 'go.mod', 'pom.xml', 'Cargo.lock', 'Gemfile', 'composer.json'] }],
  async run(ctx) {
    const targetDir = ctx.config.scanners.osv?.targetDir || '.';
    return runOsvScanner(targetDir, ctx.detectedLanguages);
  }
};

