import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';
import { isSafeUrl } from '../utils/security.js';
import fs from 'fs';
import path from 'path';

// Pure parser for ZAP's JSON report, extracted for unit testing.
export function parseZapResults(parsedOutput: any, url: string): Issue[] {
  const issues: Issue[] = [];
  if (parsedOutput?.site && Array.isArray(parsedOutput.site)) {
    parsedOutput.site.forEach((site: any) => {
      if (site.alerts) {
        site.alerts.forEach((alert: any) => {
          issues.push({
            id: alert.pluginid,
            severity: mapSeverity(alert.riskdesc),
            message: `${alert.name}: ${(alert.desc || '').replace(/<[^>]*>?/gm, '').substring(0, 100)}...`,
            file: url,
            remediation: alert.solution ? alert.solution.replace(/<[^>]*>?/gm, '').substring(0, 150) : undefined,
            source: 'OWASP ZAP'
          });
        });
      }
    });
  }
  return issues;
}

export async function runZap(url?: string, authToken?: string, failOnMissingTarget: boolean = true): Promise<ScannerResult> {
  const startTime = Date.now();

  if (!url) {
    // Do NOT silently pass: a missing DAST target means dynamic vulnerabilities (XSS, CSRF,
    // SQLi, broken auth) were never tested. Surface this as a gate-relevant coverage gap.
    // For static-only repos, disable the zap scanner or set failOnMissingTarget: false.
    return {
      scannerName: 'OWASP ZAP',
      success: true,
      durationMs: 0,
      issues: [{
        id: 'DAST-COVERAGE-GAP',
        severity: failOnMissingTarget ? 'HIGH' : 'INFO',
        message: 'No target URL was available for DAST scanning, so dynamic vulnerabilities ' +
          '(XSS, CSRF, SQLi, broken authorization) were NOT tested. Provide --url <target> ' +
          '(or ensure the ephemeral deployment succeeds) to enable active scanning.',
        source: 'OWASP ZAP'
      }]
    };
  }

  // Validate target URL format to prevent malicious command parameter injection
  if (!isSafeUrl(url)) {
    return {
      scannerName: 'OWASP ZAP',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: `Invalid or restricted ZAP target URL. SSRF protection blocked access to: ${url}`
    };
  }

  const reportName = `zap-report-${Date.now()}.json`;
  const reportPath = path.resolve(process.cwd(), reportName);

  try {
    // ZAP Baseline uses Docker. It mounts the current dir to /zap/wrk/ to write the report.
    const args = [
      'run', '--rm',
      '-v', `${process.cwd()}:/zap/wrk/:rw`,
      '-t', 'ghcr.io/zaproxy/zaproxy:stable',
      'zap-full-scan.py',
      '-t', url,
      '-J', reportName
    ];

    if (authToken) {
      args.push(
        '-z',
        `-config replacer.full_list(0).description=auth1 ` +
        `-config replacer.full_list(0).enabled=true ` +
        `-config replacer.full_list(0).matchtype=REQ_HEADER ` +
        `-config replacer.full_list(0).matchstr=Authorization ` +
        `-config replacer.full_list(0).regex=false ` +
        `-config replacer.full_list(0).replacement="Bearer ${authToken}"`
      );
    }

    const result = await runCommand('docker', args, 600000); // 10 minute timeout
    const durationMs = Date.now() - startTime;

    // Docker exits with ENOENT if not installed. ZAP baseline script exits with 0 (pass), 1 (warnings), or 2 (fails).
    if (result.exitCode !== 0 && result.exitCode !== 1 && result.exitCode !== 2) {
       return {
          scannerName: 'OWASP ZAP', success: false, durationMs, issues: [],
          error: `Docker/ZAP failed (exit code ${result.exitCode}). Ensure Docker is running. Details: ${result.stderr.trim() || result.stdout.trim()}`
       };
    }

    if (!fs.existsSync(reportPath)) {
       return {
          scannerName: 'OWASP ZAP', success: false, durationMs, issues: [],
          error: `ZAP report JSON was not generated at expected path.`
       };
    }

    const fileContents = fs.readFileSync(reportPath, 'utf8');
    let parsedOutput;
    try {
      parsedOutput = JSON.parse(fileContents);
    } catch (e) {
      return { scannerName: 'OWASP ZAP', success: false, durationMs, issues: [], error: `JSON Parse error: ${e}` };
    }

    const issues: Issue[] = parseZapResults(parsedOutput, url);

    // Cleanup report file
    fs.unlinkSync(reportPath);

    return { scannerName: 'OWASP ZAP', success: true, durationMs, issues };
  } catch (err) {
     if (fs.existsSync(reportPath)) {
       fs.unlinkSync(reportPath);
     }
     return { scannerName: 'OWASP ZAP', success: false, durationMs: Date.now() - startTime, issues: [], error: (err as Error).message };
  }
}

export const zapScanner: Scanner = {
  name: 'OWASP ZAP',
  module: 'security',
  supportedLanguages: 'all',
  requiredBinaries: ['docker'],
  async run(ctx) {
    return runZap(ctx.url, ctx.authToken, ctx.config.scanners.zap?.failOnMissingTarget ?? true);
  }
};
