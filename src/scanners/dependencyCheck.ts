import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger.js';
import { ReachabilityEngine } from '../reachability/index.js';

export async function runDependencyCheck(workspaceRoot: string = process.cwd(), detectedLanguages: string[] = ['java']): Promise<ScannerResult> {
  const startTime = Date.now();
  const issues: Issue[] = [];
  let durationMs = 0;
  const reachabilityEngine = new ReachabilityEngine(workspaceRoot, detectedLanguages as any);

  try {
    const isMaven = fs.existsSync(path.join(workspaceRoot, 'pom.xml'));
    const isGradle = fs.existsSync(path.join(workspaceRoot, 'build.gradle')) || fs.existsSync(path.join(workspaceRoot, 'build.gradle.kts'));

    if (!isMaven && !isGradle) {
      return { scannerName: 'OWASP Dependency-Check', success: true, durationMs: 0, issues: [], error: 'Neither pom.xml nor build.gradle found.' };
    }

    const cmd = isMaven ? 'mvn' : 'gradle';
    const args = isMaven 
        ? ['org.owasp:dependency-check-maven:check', '-Dformat=JSON'] 
        : ['dependencyCheckAnalyze', '--info']; // Gradle output format needs to be configured in build.gradle usually

    logger.info(`Running OWASP Dependency-Check via ${cmd}...`);
    const result = await runCommand(cmd, args, 600000); // Can take up to 10 mins to download CVE DB
    durationMs = Date.now() - startTime;

    // Build might fail if CVSS threshold is met
    const reportPaths = [
        'target/dependency-check-report.json',
        'build/reports/dependency-check-report.json'
    ];
    
    let reportPath = '';
    for (const p of reportPaths) {
        if (fs.existsSync(path.join(workspaceRoot, p))) {
            reportPath = path.join(workspaceRoot, p);
            break;
        }
    }

    if (!reportPath) {
        if (result.exitCode !== 0) {
            return { scannerName: 'OWASP Dependency-Check', success: false, durationMs, issues: [], error: `Execution failed: ${result.stderr}` };
        }
        return { scannerName: 'OWASP Dependency-Check', success: true, durationMs, issues };
    }

    const jsonData = fs.readFileSync(reportPath, 'utf-8');
    const parsed = JSON.parse(jsonData);

    if (parsed.dependencies) {
        const packageReachabilityCache = new Map<string, boolean>();

        for (const dep of parsed.dependencies) {
            if (dep.vulnerabilities && dep.vulnerabilities.length > 0) {
                // Dependency-Check often gives Maven coordinates or filenames
                const pkgName = dep.packages?.[0]?.id || dep.fileName;
                let isReachable = true;

                if (pkgName) {
                    if (packageReachabilityCache.has(pkgName)) {
                        isReachable = packageReachabilityCache.get(pkgName)!;
                    } else {
                        // Pass down to reachability engine
                        const reachability = await reachabilityEngine.checkPackage(pkgName);
                        isReachable = reachability.isReachable;
                        packageReachabilityCache.set(pkgName, isReachable);
                    }
                }

                for (const vuln of dep.vulnerabilities) {
                    let severityStr = vuln.severity || 'HIGH';
                    let severity = mapSeverity(severityStr);
                    let prefix = '';

                    if (!isReachable) {
                        severity = 'INFO';
                        prefix = '[UNREACHABLE] ';
                    }

                    issues.push({
                        id: vuln.name,
                        severity,
                        message: `${prefix}${dep.fileName} is vulnerable: ${vuln.description?.substring(0, 100)}...`,
                        file: 'pom.xml/build.gradle',
                        source: 'OWASP Dependency-Check'
                    });
                }
            }
        }
    }

    return { scannerName: 'OWASP Dependency-Check', success: true, durationMs, issues };

  } catch (err: any) {
    return {
      scannerName: 'OWASP Dependency-Check',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: err.message
    };
  }
}

export const dependencyCheckScanner: Scanner = {
  name: 'OWASP Dependency-Check',
  module: 'security',
  supportedLanguages: ['java'],
  async run(ctx) {
    return runDependencyCheck(process.cwd(), ctx.detectedLanguages);
  }
};
