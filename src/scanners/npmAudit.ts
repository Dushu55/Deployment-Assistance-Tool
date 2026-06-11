import fs from 'fs';
import path from 'path';
import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner, Severity } from '../types.js';

/**
 * Zero-cost npm advisory check: `npm audit --json` against the registry. npm ships with Node, so
 * this needs no extra tooling — it backstops Trivy/OSV-Scanner on machines where neither is
 * installed. Lockfile-based; gracefully skips without one.
 */

const SRC = 'npm audit';

// npm's own severity scale. NOT utils.mapSeverity — that helper defaults unknown strings
// ('moderate') to HIGH, which would inflate every moderate advisory.
const NPM_SEVERITY: Record<string, Severity> = {
  critical: 'CRITICAL', high: 'HIGH', moderate: 'MEDIUM', low: 'LOW', info: 'INFO',
};

/** Pure parser for `npm audit --json` (npm v7+ shape), exported for unit tests. */
export function parseNpmAudit(parsed: any): Issue[] {
  const issues: Issue[] = [];
  const vulns = parsed?.vulnerabilities;
  if (!vulns || typeof vulns !== 'object') return issues;

  for (const [pkg, v] of Object.entries<any>(vulns)) {
    const severity = NPM_SEVERITY[String(v?.severity).toLowerCase()] ?? 'MEDIUM';
    // `via` mixes advisory objects and plain package-name strings (transitive chains).
    const advisory = Array.isArray(v?.via) ? v.via.find((x: any) => typeof x === 'object') : undefined;
    const ghsa = advisory?.url?.match(/GHSA-[\w-]+/)?.[0];
    const title = advisory?.title ? `: ${advisory.title}` : ' (via transitive dependencies)';
    let remediation: string | undefined;
    if (v?.fixAvailable === true) remediation = 'Run `npm audit fix`.';
    else if (v?.fixAvailable && typeof v.fixAvailable === 'object') {
      remediation = `Upgrade ${v.fixAvailable.name} to ${v.fixAvailable.version}` +
        (v.fixAvailable.isSemVerMajor ? ' (major version bump — review breaking changes).' : '.');
    } else remediation = 'No fixed release yet — monitor the advisory and consider an override/patch.';

    issues.push({
      id: ghsa || `NPM-AUDIT-${pkg}`,
      severity,
      message: `Package ${pkg} (${v?.range || 'installed'}) is vulnerable${title}`,
      file: 'package-lock.json',
      remediation,
      source: SRC,
      category: 'security',
    });
  }
  return issues;
}

export async function runNpmAudit(targetDir: string = '.'): Promise<ScannerResult> {
  const startTime = Date.now();
  const dir = path.resolve(process.cwd(), targetDir);

  const hasLockfile = ['package-lock.json', 'npm-shrinkwrap.json']
    .some((f) => fs.existsSync(path.join(dir, f)));
  if (!hasLockfile) {
    return {
      scannerName: SRC, success: true, durationMs: Date.now() - startTime,
      issues: [{
        id: 'NPM-AUDIT-NO-LOCKFILE', severity: 'INFO', source: SRC,
        message: 'npm audit needs a lockfile; run `npm install --package-lock-only` to generate one.',
      }]
    };
  }

  try {
    // exit 0 = clean, exit 1 = vulnerabilities found; anything else inspect below.
    const result = await runCommand('npm', ['audit', '--json', '--audit-level=info'], 120000, dir);
    const durationMs = Date.now() - startTime;

    let parsed: any;
    try { parsed = JSON.parse(result.stdout); } catch { parsed = null; }

    // npm reports registry/network problems as an `error` object (e.g. ENOTFOUND, ENOLOCK).
    if (parsed?.error) {
      const code = String(parsed.error.code || '');
      const offline = /ENOTFOUND|ENETUNREACH|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENOAUDIT/i.test(code);
      return {
        scannerName: SRC, success: true, durationMs,
        issues: [{
          id: offline ? 'NPM-AUDIT-OFFLINE' : 'NPM-AUDIT-SKIPPED', severity: 'INFO', source: SRC,
          message: `npm audit could not run (${code || 'registry error'}) — advisories unchecked this run.`,
        }]
      };
    }
    if (!parsed || (result.exitCode !== 0 && result.exitCode !== 1)) {
      return {
        scannerName: SRC, success: false, durationMs, issues: [],
        error: `npm audit exited with code ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim().slice(0, 300)}`
      };
    }

    return { scannerName: SRC, success: true, durationMs, issues: parseNpmAudit(parsed) };
  } catch (err) {
    return {
      scannerName: SRC, success: false, durationMs: Date.now() - startTime, issues: [],
      error: (err as Error).message
    };
  }
}

export const npmAuditScanner: Scanner = {
  name: SRC,
  module: 'security',
  supportedLanguages: ['node'],
  requiredBinaries: ['npm'],
  expectedInputs: [{
    label: 'package-lock.json', category: 'lockfile',
    anyOf: ['package-lock.json', 'npm-shrinkwrap.json'],
    consequence: 'Known npm advisory CVEs in the dependency tree are unchecked.'
  }],
  async run(ctx) {
    return runNpmAudit(ctx.config.scanners.npmAudit?.targetDir || '.');
  }
};
