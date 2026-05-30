import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';
import * as fs from 'fs';
import * as path from 'path';
import { ReachabilityEngine } from '../reachability/index.js';

export async function runCargoAudit(workspaceRoot: string = process.cwd(), detectedLanguages: string[] = ['rust']): Promise<ScannerResult> {
  const startTime = Date.now();
  const issues: Issue[] = [];
  let durationMs = 0;
  const reachabilityEngine = new ReachabilityEngine(workspaceRoot, detectedLanguages as any);

  try {
    if (!fs.existsSync(path.join(workspaceRoot, 'Cargo.lock'))) {
      return { scannerName: 'cargo-audit', success: true, durationMs: 0, issues: [], error: 'No Cargo.lock found. run `cargo generate-lockfile` first.' };
    }

    const cmd = 'cargo';
    const args = ['audit', '--json'];
    
    const result = await runCommand(cmd, args, 120000);
    durationMs = Date.now() - startTime;

    // cargo audit exits with 1 if vulnerabilities are found
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return {
        scannerName: 'cargo-audit',
        success: false,
        durationMs,
        issues: [],
        error: `cargo audit exited with code ${result.exitCode}. Details: ${result.stderr.trim() || result.stdout.trim()}`
      };
    }

    if (!result.stdout.trim() || !result.stdout.includes('{')) {
       return { scannerName: 'cargo-audit', success: true, durationMs, issues };
    }

    const jsonStart = result.stdout.indexOf('{');
    const jsonEnd = result.stdout.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      return { scannerName: 'cargo-audit', success: true, durationMs, issues };
    }

    const parsedOutput = JSON.parse(result.stdout.substring(jsonStart, jsonEnd + 1));

    if (parsedOutput.vulnerabilities && parsedOutput.vulnerabilities.list) {
      const packageReachabilityCache = new Map<string, boolean>();

      for (const vuln of parsedOutput.vulnerabilities.list) {
        const packageName = vuln.package?.name;
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

        let severityStr = 'HIGH';
        if (vuln.advisory?.cvss_v3) {
            // Can extract severity from CVSS, but RustSec usually implies High unless noted
            severityStr = 'HIGH'; 
        }

        let severity = mapSeverity(severityStr);
        let prefix = '';

        if (!isReachable) {
            severity = 'INFO';
            prefix = '[UNREACHABLE] ';
        }

        issues.push({
            id: vuln.advisory?.id || 'rustsec-vuln',
            severity,
            message: `${prefix}${packageName} (${vuln.package?.version}) is vulnerable: ${vuln.advisory?.title}`,
            file: 'Cargo.lock',
            remediation: `Update to ${vuln.versions?.patched?.join(', ') || 'latest patched version'}`,
            source: 'cargo-audit'
        });
      }
    }

    return { scannerName: 'cargo-audit', success: true, durationMs, issues };

  } catch (err: any) {
    return {
      scannerName: 'cargo-audit',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: err.message
    };
  }
}

export const cargoAuditScanner: Scanner = {
  name: 'cargo-audit',
  module: 'security',
  supportedLanguages: ['rust'],
  requiredBinaries: ['cargo'],
  expectedInputs: [{ label: 'Cargo.lock', category: 'lockfile', anyOf: ['Cargo.lock'], consequence: 'Rust crate CVEs (RustSec advisories) are not checked.' }],
  async run(ctx) {
    return runCargoAudit(process.cwd(), ctx.detectedLanguages);
  }
};
