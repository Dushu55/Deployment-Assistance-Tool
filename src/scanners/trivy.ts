import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';
import { ReachabilityEngine } from '../reachability/index.js';
import fs from 'fs';
import path from 'path';

export async function runTrivy(targetDir: string = '.', generateSbom: boolean = false, sbomPath: string = 'results/bom.json', detectedLanguages: string[] = ['node']): Promise<ScannerResult> {
  const startTime = Date.now();
  const issues: Issue[] = [];
  let durationMs = 0;
  const reachabilityEngine = new ReachabilityEngine(process.cwd(), detectedLanguages as any);

  try {
    // If SBOM generation is enabled, execute Trivy to generate CycloneDX SBOM
    if (generateSbom) {
      const fullSbomPath = path.resolve(process.cwd(), sbomPath);
      fs.mkdirSync(path.dirname(fullSbomPath), { recursive: true });
      
      const sbomResult = await runCommand('trivy', ['fs', '--format', 'cyclonedx', '--output', fullSbomPath, targetDir], 300000);
      if (sbomResult.exitCode !== 0) {
        console.warn(`[Trivy SBOM] Failed to generate CycloneDX SBOM. Details: ${sbomResult.stderr.trim()}`);
      } else {
        issues.push({
          id: 'SBOM-GENERATED',
          severity: 'INFO',
          message: `CycloneDX SBOM successfully generated and saved to ${sbomPath}`,
          source: 'Trivy'
        });
      }
    }

    const result = await runCommand('trivy', ['fs', '-f', 'json', '--quiet', targetDir], 300000);
    durationMs = Date.now() - startTime;

    if (result.exitCode !== 0 && result.exitCode !== 1) {
        return {
            scannerName: 'Trivy (FS)',
            success: false,
            durationMs,
            issues,
            error: `Trivy exited with code ${result.exitCode}. Details: ${result.stderr.trim()}`
        };
    }

    const parsedOutput = JSON.parse(result.stdout || '{}');

    if (parsedOutput.Results) {
        for (const res of parsedOutput.Results) {
            const targetFile = res.Target;
            if (res.Vulnerabilities) {
                // Deduplicate reachability checks for performance
                const packageReachabilityCache = new Map<string, boolean>();

                for (const v of res.Vulnerabilities) {
                    const pkgName = v.PkgName;
                    let isReachable = true;

                    if (pkgName) {
                        if (packageReachabilityCache.has(pkgName)) {
                            isReachable = packageReachabilityCache.get(pkgName)!;
                        } else {
                            const reachability = await reachabilityEngine.checkNodePackage(pkgName);
                            isReachable = reachability.isReachable;
                            packageReachabilityCache.set(pkgName, isReachable);
                        }
                    }

                    let severity = mapSeverity(v.Severity);
                    let prefix = '';

                    if (!isReachable) {
                        severity = 'INFO';
                        prefix = '[UNREACHABLE] ';
                    }

                    issues.push({
                        id: v.VulnerabilityID,
                        severity,
                        message: `${prefix}${v.PkgName} (${v.InstalledVersion}) is vulnerable.`,
                        file: targetFile,
                        remediation: v.FixedVersion ? `Update to ${v.FixedVersion}` : 'No fix available',
                        source: 'Trivy'
                    });
                }
            }
            if (res.Misconfigurations) {
                for (const m of res.Misconfigurations) {
                    issues.push({
                        id: m.ID,
                        severity: mapSeverity(m.Severity),
                        message: m.Message,
                        file: targetFile,
                        remediation: m.Resolution,
                        source: 'Trivy'
                    });
                }
            }
        }
    }

    return {
      scannerName: 'Trivy (FS)',
      success: true,
      durationMs,
      issues
    };
  } catch (err) {
    return {
      scannerName: 'Trivy (FS)',
      success: false,
      durationMs: Date.now() - startTime,
      issues,
      error: (err as Error).message
    };
  }
}

export const trivyScanner: Scanner = {
  name: 'Trivy',
  module: 'security',
  supportedLanguages: 'all',
  requiredBinaries: ['trivy'],
  expectedInputs: [{ label: 'Dependency manifest', category: 'deps', anyOf: ['package.json', 'requirements.txt', 'go.mod', 'pom.xml', 'Cargo.lock', 'Gemfile', 'composer.json'], consequence: 'Supply-chain vulnerabilities (Log4Shell pattern) are unscanned.' }],
  async run(ctx) {
    const generateSbom = ctx.config.scanners.trivy?.generateSbom || false;
    const sbomPath = ctx.config.scanners.trivy?.sbomPath || 'results/bom.json';
    return runTrivy('.', generateSbom, sbomPath, ctx.detectedLanguages);
  }
};

