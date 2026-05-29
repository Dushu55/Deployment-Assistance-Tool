import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { isSafeUrl } from '../utils/security.js';
import fs from 'fs';
import path from 'path';

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
    const issues: Issue[] = [];
    
    const p95Latency = summary.metrics?.http_req_duration?.['p(95)'];
    
    if (p95Latency && p95Latency > thresholdMs) {
        issues.push({
            id: 'HIGH-LATENCY-P95',
            severity: 'HIGH',
            message: `p95 Latency (${p95Latency.toFixed(2)}ms) exceeded threshold of ${thresholdMs}ms.`,
            file: targetUrl,
            source: 'k6'
        });
    } else if (p95Latency) {
        issues.push({
            id: 'LATENCY-OK',
            severity: 'INFO',
            message: `p95 Latency (${p95Latency.toFixed(2)}ms) is within acceptable limits.`,
            source: 'k6'
        });
    }

    const passRate = summary.metrics?.checks?.value;
    if (passRate !== undefined && passRate < 1) {
        issues.push({
            id: 'HTTP-CHECKS-FAILED',
            severity: 'HIGH',
            message: `${((1 - passRate) * 100).toFixed(2)}% of HTTP requests failed the status==200 check.`,
            source: 'k6'
        });
    }

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
  async run(ctx) {
    const thresholdMs = ctx.config.scanners.k6?.thresholdMs || 500;
    return runK6(ctx.url, thresholdMs, ctx.authToken, ctx.config.scanners.k6?.failOnMissingTarget ?? true);
  }
};
