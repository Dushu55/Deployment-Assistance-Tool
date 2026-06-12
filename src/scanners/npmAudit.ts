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

/** Parse the leading numeric semver core (major.minor.patch) from a version or range string. */
function parseVersionCore(v: string): [number, number, number] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? ''));
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const loose = /(\d+)(?:\.(\d+))?/.exec(String(v ?? '')); // tolerate "16" or "16.3"
  return loose ? [Number(loose[1]), Number(loose[2] ?? 0), 0] : null;
}

/**
 * True when `to` is a strictly higher version than `from`. Used to reject npm audit's `fixAvailable`
 * when it points at a LOWER version than what's installed (npm's nested fix data can suggest, e.g.,
 * "next@9.3.3" for an app on next@16 — a destructive downgrade). When either version can't be parsed
 * we return true so the upgrade suggestion is preserved (no information ⇒ don't second-guess npm).
 */
export function isForwardUpgrade(from: string, to: string): boolean {
  const a = parseVersionCore(from), b = parseVersionCore(to);
  if (!a || !b) return true;
  for (let i = 0; i < 3; i++) if (b[i] !== a[i]) return b[i] > a[i];
  return false; // identical core ⇒ not a forward upgrade
}

/**
 * Pure parser for `npm audit --json` (npm v7+ shape), exported for unit tests.
 * `installed` maps package name → declared/installed version (from package.json) so we can refuse to
 * recommend a downgrade.
 */
export function parseNpmAudit(parsed: any, installed: Record<string, string> = {}): Issue[] {
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
      const fixName = v.fixAvailable.name;
      const fixVer = v.fixAvailable.version;
      const current = installed[fixName];
      if (current && !isForwardUpgrade(current, fixVer)) {
        // npm's suggested fix would DOWNGRADE the package — never recommend that.
        remediation = `npm audit's suggested fix (${fixName}@${fixVer}) is not a forward upgrade from the installed ${fixName}@${current} — do NOT downgrade. Review the advisory and pin a forward-compatible version (an "overrides"/"resolutions" entry) or await a patched release.`;
      } else {
        remediation = `Upgrade ${fixName} to ${fixVer}` +
          (v.fixAvailable.isSemVerMajor ? ' (major version bump — review breaking changes).' : '.');
      }
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

/** Declared dependency versions from package.json (name → version range), for downgrade detection. */
function readInstalledVersions(dir: string): Record<string, string> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
  } catch { return {}; }
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

    return { scannerName: SRC, success: true, durationMs, issues: parseNpmAudit(parsed, readInstalledVersions(dir)) };
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
