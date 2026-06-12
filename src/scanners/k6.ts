import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { isSafeUrl } from '../utils/security.js';
import fs from 'fs';
import path from 'path';

/** A "target isn't serving 200s" finding — used by both the pre-flight probe and the summary eval. */
function unreachableFinding(targetUrl: string, detail: string): Issue {
  return {
    id: 'TARGET-UNREACHABLE',
    severity: 'HIGH',
    message: `Load-test target is not serving HTTP 200 (${detail}); performance under load could not be measured. ` +
      'This usually means the deployment did not boot (e.g. missing runtime env/DATABASE_URL), an auth/IAM block, or a wrong path — not that the app is slow.',
    file: targetUrl,
    source: 'k6',
    category: 'robustness',
    remediation: 'Confirm the deployed target boots and serves HTTP 200 (runtime secrets/DATABASE_URL, networking, and auth/IAM), then re-run the load test.',
  };
}

/**
 * Turn a k6 summary into findings. Pure (no I/O) so it is unit-testable.
 *
 * Correctness rule: if the target failed the `status==200` check for the MAJORITY of requests, the run
 * measured error responses, not performance — so a "high p95 latency" reading is meaningless (it's the
 * latency of errors). In that case we emit a single TARGET-UNREACHABLE finding (pointing at deploy/auth/DB
 * misconfig) and SUPPRESS the latency finding. Latency is only reported when most requests succeeded.
 */
export function evaluateK6Summary(
  summary: any,
  opts: { thresholdMs: number; targetUrl: string; probeStatus?: number | null }
): Issue[] {
  const issues: Issue[] = [];
  const p95: number | undefined = summary?.metrics?.http_req_duration?.['p(95)'];
  const passRate: number | undefined = summary?.metrics?.checks?.value;
  const failPct = passRate !== undefined ? (1 - passRate) * 100 : undefined;
  const probeNote = (opts.probeStatus !== undefined && opts.probeStatus !== null)
    ? ` (pre-flight GET → HTTP ${opts.probeStatus})` : '';

  // Target effectively down (majority of requests non-200): latency is not trustworthy here.
  if (passRate !== undefined && passRate < 0.5) {
    issues.push(unreachableFinding(opts.targetUrl, `${failPct!.toFixed(2)}% of requests returned non-200${probeNote}`));
    return issues;
  }

  // Some requests failed, but the target is mostly up — a real partial-availability finding.
  if (passRate !== undefined && passRate < 1) {
    issues.push({
      id: 'HTTP-CHECKS-FAILED',
      severity: 'HIGH',
      message: `${failPct!.toFixed(2)}% of HTTP requests failed the status==200 check${probeNote}.`,
      file: opts.targetUrl,
      source: 'k6',
      category: 'robustness',
    });
  }

  // Latency is only meaningful when most requests actually succeeded.
  if (p95 && p95 > opts.thresholdMs) {
    issues.push({
      id: 'HIGH-LATENCY-P95',
      severity: 'HIGH',
      message: `p95 Latency (${p95.toFixed(2)}ms) exceeded threshold of ${opts.thresholdMs}ms.`,
      file: opts.targetUrl,
      source: 'k6',
      category: 'robustness',
    });
  } else if (p95) {
    issues.push({
      id: 'LATENCY-OK',
      severity: 'INFO',
      message: `p95 Latency (${p95.toFixed(2)}ms) is within acceptable limits.`,
      source: 'k6',
    });
  }

  return issues;
}

export async function runK6(targetUrl?: string, thresholdMs: number = 500, authToken?: string, failOnMissingTarget: boolean = true): Promise<ScannerResult> {
  const startTime = Date.now();

  if (!targetUrl) {
    // Do NOT silently pass: without a target, performance/robustness under load was never
    // measured. Surface as a gate-relevant coverage gap (disable k6 or set
    // failOnMissingTarget: false for static-only repos).
    return {
      scannerName: 'k6 Load Test',
      success: true,
      durationMs: 0,
      issues: [{
        id: 'LOAD-COVERAGE-GAP',
        severity: failOnMissingTarget ? 'HIGH' : 'INFO',
        message: 'No target URL was available for load testing, so performance and robustness ' +
          'under load were NOT measured. Provide --url to enable.',
        source: 'k6'
      }]
    };
  }

  // Validate URL to prevent command/param injection or SSRF hijacks
  if (!isSafeUrl(targetUrl)) {
    return {
      scannerName: 'k6 Load Test',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: `Invalid or restricted k6 target URL. SSRF protection blocked access to: ${targetUrl}`
    };
  }

  // Pre-flight reachability probe: one authenticated request tells us whether the target serves 200s
  // at all. If it doesn't, a full 120s load test would only measure error responses — short-circuit
  // with a clear, actionable reachability finding instead of a misleading "high latency" result.
  let probeStatus: number | null = null;
  try {
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(targetUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    probeStatus = res.status;
    if (res.status < 200 || res.status >= 300) {
      return {
        scannerName: 'k6 Load Test', success: true, durationMs: Date.now() - startTime,
        issues: [unreachableFinding(targetUrl, `pre-flight GET returned HTTP ${res.status}`)],
      };
    }
  } catch (e) {
    return {
      scannerName: 'k6 Load Test', success: true, durationMs: Date.now() - startTime,
      issues: [unreachableFinding(targetUrl, `pre-flight request failed: ${(e as Error).message}`)],
    };
  }

  const scriptPath = path.resolve(process.cwd(), `k6-script-${Date.now()}.js`);
  const summaryPath = path.resolve(process.cwd(), `k6-summary-${Date.now()}.json`);

  // Generate a simple secure k6 script reading the target URL from environmental variables
  const scriptContent = `
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '5s',
};

export default function () {
  const params = {
    headers: {}
  };
  
  if (__ENV.K6_AUTH_TOKEN) {
    params.headers['Authorization'] = \`Bearer \${__ENV.K6_AUTH_TOKEN}\`;
  }

  const res = http.get(__ENV.K6_TARGET_URL, params);
  check(res, { 'status was 200': (r) => r.status == 200 });
  sleep(1);
}
  `;
  
  fs.writeFileSync(scriptPath, scriptContent);

  // Set the target URL securely in the environment so k6 can read it via __ENV.K6_TARGET_URL
  const originalUrl = process.env.K6_TARGET_URL;
  process.env.K6_TARGET_URL = targetUrl;
  
  const originalToken = process.env.K6_AUTH_TOKEN;
  if (authToken) {
    process.env.K6_AUTH_TOKEN = authToken;
  }

  try {
    const result = await runCommand('k6', ['run', '--summary-export', summaryPath, scriptPath], 120000);
    const durationMs = Date.now() - startTime;

    if (result.exitCode !== 0 && result.exitCode !== 1 && !fs.existsSync(summaryPath)) { 
       return {
          scannerName: 'k6 Load Test', success: false, durationMs, issues: [],
          error: `k6 failed to run. Is k6 installed? Details: ${result.stderr.trim() || result.stdout.trim()}`
       };
    }

    if (!fs.existsSync(summaryPath)) {
       return { scannerName: 'k6 Load Test', success: false, durationMs, issues: [], error: `k6 summary JSON was not generated.` };
    }

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const issues = evaluateK6Summary(summary, { thresholdMs, targetUrl, probeStatus });

    // Cleanup
    fs.unlinkSync(scriptPath);
    fs.unlinkSync(summaryPath);
    
    if (originalUrl === undefined) {
      delete process.env.K6_TARGET_URL;
    } else {
      process.env.K6_TARGET_URL = originalUrl;
    }

    if (originalToken === undefined) {
      delete process.env.K6_AUTH_TOKEN;
    } else {
      process.env.K6_AUTH_TOKEN = originalToken;
    }

    return { scannerName: 'k6 Load Test', success: true, durationMs, issues };
  } catch (err) {
     if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
     if (fs.existsSync(summaryPath)) fs.unlinkSync(summaryPath);
     
     if (originalUrl === undefined) {
       delete process.env.K6_TARGET_URL;
     } else {
       process.env.K6_TARGET_URL = originalUrl;
     }
     
     if (originalToken === undefined) {
       delete process.env.K6_AUTH_TOKEN;
     } else {
       process.env.K6_AUTH_TOKEN = originalToken;
     }

     return { scannerName: 'k6 Load Test', success: false, durationMs: Date.now() - startTime, issues: [], error: (err as Error).message };
  }
}

export const k6Scanner: Scanner = {
  name: 'k6 Load Test',
  module: 'testing',
  supportedLanguages: 'all',
  requiredBinaries: ['k6'],
  expectedInputs: [{ label: 'DAST target URL', category: 'dastTarget', kind: 'url', consequence: 'Performance and robustness under load are unmeasured.' }],
  async run(ctx) {
    const thresholdMs = ctx.config.scanners.k6?.thresholdMs || 500;
    return runK6(ctx.url, thresholdMs, ctx.authToken, ctx.config.scanners.k6?.failOnMissingTarget ?? true);
  }
};
