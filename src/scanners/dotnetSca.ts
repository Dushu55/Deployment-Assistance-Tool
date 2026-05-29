import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';
import { ReachabilityEngine } from '../reachability/index.js';

export async function runDotnetSca(workspaceRoot: string = process.cwd(), detectedLanguages: string[] = ['csharp']): Promise<ScannerResult> {
  const startTime = Date.now();
  const issues: Issue[] = [];
  let durationMs = 0;
  const reachabilityEngine = new ReachabilityEngine(workspaceRoot, detectedLanguages as any);

  try {
    // Requires NuGet packages to be restored first
    await runCommand('dotnet', ['restore'], 60000);

    const cmd = 'dotnet';
    const args = ['list', 'package', '--vulnerable', '--format', 'json'];
    
    const result = await runCommand(cmd, args, 120000);
    durationMs = Date.now() - startTime;

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return { scannerName: '.NET NuGet Audit', success: false, durationMs, issues: [], error: `dotnet list package failed: ${result.stderr}` };
    }

    if (!result.stdout.trim() || !result.stdout.includes('{')) {
      return { scannerName: '.NET NuGet Audit', success: true, durationMs, issues };
    }

    // Extract JSON block (in case there is leading non-JSON output)
    const jsonStart = result.stdout.indexOf('{');
    const jsonEnd = result.stdout.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      return { scannerName: '.NET NuGet Audit', success: true, durationMs, issues };
    }

    const parsed = JSON.parse(result.stdout.substring(jsonStart, jsonEnd + 1));

    if (parsed.projects && Array.isArray(parsed.projects)) {
      const packageReachabilityCache = new Map<string, boolean>();

      for (const project of parsed.projects) {
        if (project.frameworks && Array.isArray(project.frameworks)) {
          for (const fw of project.frameworks) {
            if (fw.topLevelPackages && Array.isArray(fw.topLevelPackages)) {
              for (const pkg of fw.topLevelPackages) {
                if (pkg.vulnerabilities && Array.isArray(pkg.vulnerabilities)) {
                  const packageName = pkg.id;
                  let isReachable = true;

                  if (packageName) {
                    if (packageReachabilityCache.has(packageName)) {
                      isReachable = packageReachabilityCache.get(packageName)!;
                    } else {
                      const reachability = await reachabilityEngine.checkPackage(packageName);
                      isReachable = reachability.isReachable;
                      packageReachabilityCache.set(packageName, isReachable);
                    }
                  }

                  for (const vuln of pkg.vulnerabilities) {
                    let severity = mapSeverity(vuln.severity || 'HIGH');
                    let prefix = '';

                    if (!isReachable) {
                      severity = 'INFO';
                      prefix = '[UNREACHABLE] ';
                    }

                    issues.push({
                      id: vuln.advisoryurl || 'nuget-vuln',
                      severity,
                      message: `${prefix}${pkg.id} (${pkg.resolvedVersion}) is vulnerable.`,
                      file: project.path || 'unknown',
                      source: '.NET NuGet Audit'
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    return { scannerName: '.NET NuGet Audit', success: true, durationMs, issues };

  } catch (err: any) {
    return {
      scannerName: '.NET NuGet Audit',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: err.message
    };
  }
}

export const dotnetScaScanner: Scanner = {
  name: '.NET NuGet Audit',
  module: 'security',
  supportedLanguages: ['csharp'],
  requiredBinaries: ['dotnet'],
  async run(ctx) {
    return runDotnetSca(process.cwd(), ctx.detectedLanguages);
  }
};
