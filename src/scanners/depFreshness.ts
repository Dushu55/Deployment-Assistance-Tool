import fs from 'fs';
import { runCommand } from '../runner.js';
import { isBinaryAvailable } from '../utils/preflight.js';
import { ScannerResult, Issue, Scanner } from '../types.js';

/**
 * Zero-cost maintenance-debt check: how far dependencies have drifted behind upstream
 * (`npm outdated` / `pip list --outdated`). Major-version lag is a LOW per-package finding;
 * minor/patch drift collapses into one INFO summary per ecosystem so it never becomes noise.
 *
 * Deliberately NO `requiredBinaries`: the orchestrator preflight is all-or-nothing, and
 * declaring npm+pip3 would skip the whole scanner on any box missing either. Each ecosystem
 * probes its own tool inside run() instead.
 */

const SRC = 'Dependency Freshness';

/** Lenient leading-integer major-version distance ('17.0.2' → 17). Non-numeric → 0. */
export function majorsBehind(current: string, latest: string): number {
  const major = (v: string) => parseInt(String(v).replace(/^[^0-9]*/, ''), 10);
  const c = major(current), l = major(latest);
  if (!Number.isFinite(c) || !Number.isFinite(l)) return 0;
  return Math.max(0, l - c);
}

function freshnessIssues(
  rows: { name: string; current: string; latest: string }[],
  manifest: string,
  minorSummaryId: string,
): Issue[] {
  const issues: Issue[] = [];
  let minorDrift = 0;
  for (const r of rows) {
    const behind = majorsBehind(r.current, r.latest);
    if (behind >= 1) {
      issues.push({
        id: `DEP-OUTDATED-${r.name}`, severity: 'LOW', source: SRC, file: manifest,
        category: 'best-practice',
        message: `${r.name} is ${behind} major version${behind > 1 ? 's' : ''} behind (${r.current} → ${r.latest}).`,
        remediation: `Review the ${r.name} changelog and upgrade (major bumps may need code changes).`,
      });
    } else if (r.latest && r.latest !== r.current) {
      minorDrift++;
    }
  }
  if (minorDrift > 0) {
    issues.push({
      id: minorSummaryId, severity: 'INFO', source: SRC, file: manifest, category: 'best-practice',
      message: `${minorDrift} package${minorDrift > 1 ? 's have' : ' has'} newer minor/patch releases — routine update recommended.`,
    });
  }
  return issues;
}

/** Pure parser for `npm outdated --json` ({ pkg: { current, latest } }), exported for tests. */
export function parseNpmOutdated(parsed: any): Issue[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const rows = Object.entries<any>(parsed).map(([name, v]) => ({
    name, current: String(v?.current ?? ''), latest: String(v?.latest ?? ''),
  })).filter((r) => r.current && r.latest);
  return freshnessIssues(rows, 'package.json', 'DEP-FRESH-NODE-MINOR');
}

/** Pure parser for `pip list --outdated --format=json`, exported for tests. */
export function parsePipOutdated(parsed: any): Issue[] {
  if (!Array.isArray(parsed)) return [];
  const rows = parsed.map((p: any) => ({
    name: String(p?.name ?? ''), current: String(p?.version ?? ''), latest: String(p?.latest_version ?? ''),
  })).filter((r) => r.name && r.current && r.latest);
  return freshnessIssues(rows, 'requirements.txt', 'DEP-FRESH-PY-MINOR');
}

function skipInfo(ecosystem: string, reason: string): Issue {
  return {
    id: `DEP-FRESH-SKIPPED-${ecosystem}`, severity: 'INFO', source: SRC,
    message: `Dependency freshness (${ecosystem}) skipped: ${reason}`,
  };
}

export async function runDepFreshness(detectedLanguages: string[]): Promise<ScannerResult> {
  const startTime = Date.now();
  const issues: Issue[] = [];

  try {
    if (detectedLanguages.includes('node') && fs.existsSync('package.json')) {
      if (await isBinaryAvailable('npm')) {
        // exit 1 with JSON = outdated packages exist; empty stdout = everything current.
        const res = await runCommand('npm', ['outdated', '--json'], 120000);
        if (res.exitCode === 0 || res.exitCode === 1) {
          try { issues.push(...parseNpmOutdated(res.stdout.trim() ? JSON.parse(res.stdout) : {})); }
          catch { issues.push(skipInfo('node', 'npm outdated returned unparseable output.')); }
        } else {
          issues.push(skipInfo('node', `npm outdated exited with code ${res.exitCode}.`));
        }
      } else {
        issues.push(skipInfo('node', 'npm is not on PATH.'));
      }
    }

    const pyManifest = ['requirements.txt', 'pyproject.toml'].find((f) => fs.existsSync(f));
    if (detectedLanguages.includes('python') && pyManifest) {
      const pip = (await isBinaryAvailable('pip3')) ? 'pip3' : (await isBinaryAvailable('pip')) ? 'pip' : null;
      if (pip) {
        const res = await runCommand(pip, ['list', '--outdated', '--format=json'], 120000);
        if (res.exitCode === 0) {
          try { issues.push(...parsePipOutdated(res.stdout.trim() ? JSON.parse(res.stdout) : [])); }
          catch { issues.push(skipInfo('python', `${pip} returned unparseable output.`)); }
        } else {
          issues.push(skipInfo('python', `${pip} list --outdated exited with code ${res.exitCode}.`));
        }
      } else {
        issues.push(skipInfo('python', 'pip is not on PATH.'));
      }
    }

    return { scannerName: SRC, success: true, durationMs: Date.now() - startTime, issues };
  } catch (err) {
    return {
      scannerName: SRC, success: false, durationMs: Date.now() - startTime, issues: [],
      error: (err as Error).message
    };
  }
}

export const depFreshnessScanner: Scanner = {
  name: SRC,
  module: 'static',
  supportedLanguages: ['node', 'python'],
  expectedInputs: [{
    label: 'Dependency manifest', category: 'deps',
    anyOf: ['package.json', 'requirements.txt', 'pyproject.toml'],
    consequence: 'You cannot see how far dependencies have drifted behind upstream.'
  }],
  async run(ctx) {
    return runDepFreshness(ctx.detectedLanguages);
  }
};
