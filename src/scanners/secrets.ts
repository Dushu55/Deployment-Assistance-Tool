import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { logger } from '../logger.js';
import fs from 'fs';
import path from 'path';

// Build/dependency output directories Gitleaks should never report on. `--no-git` scans the raw
// working tree (ignoring .gitignore), so without this it flags Next.js build caches, node_modules, etc.
const BUILD_ARTIFACT_RE =
  /(^|\/)(\.next|node_modules|dist|build|out|coverage|\.turbo|\.cache|\.git|vendor|target|__pycache__|\.venv|venv|\.svelte-kit|\.nuxt)(\/|$)/;

export function isBuildArtifactPath(file?: string): boolean {
  return Boolean(file) && BUILD_ARTIFACT_RE.test(file as string);
}

/**
 * Of `files`, the subset Git ignores in `targetDir`. A secret living in a gitignored file (e.g. a
 * local `.env`) is in its intended place — not a committed leak — so we drop those. Only meaningful
 * inside a git work tree; returns empty otherwise.
 */
async function gitIgnoredPaths(targetDir: string, files: string[]): Promise<Set<string>> {
  const ignored = new Set<string>();
  if (files.length === 0) return ignored;
  const inside = await runCommand('git', ['-C', targetDir, 'rev-parse', '--is-inside-work-tree'], 10000);
  if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') return ignored;
  // `check-ignore` prints each ignored path; exit 0 = some ignored, 1 = none, >1 = error.
  const res = await runCommand('git', ['-C', targetDir, 'check-ignore', '--', ...files], 30000);
  if (res.exitCode === null || res.exitCode > 1) return ignored; // error / killed → don't filter
  res.stdout.split('\n').map((s) => s.trim()).filter(Boolean).forEach((p) => ignored.add(p));
  return ignored;
}

export async function runGitleaks(targetDir: string = '.'): Promise<ScannerResult> {
  const startTime = Date.now();
  const reportName = `gitleaks-report-${Date.now()}.json`;
  const reportPath = path.resolve(process.cwd(), reportName);

  try {
    // --no-git allows scanning directories without a .git folder.
    const result = await runCommand('gitleaks', ['detect', '--no-git', '-v', '-f', 'json', '-r', reportPath, '--source', targetDir], 120000);
    const durationMs = Date.now() - startTime;

    // Exit 0 = no leaks, 1 = leaks found, others = fatal.
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return {
        scannerName: 'Gitleaks (Secrets)', success: false, durationMs, issues: [],
        error: `Gitleaks exited with code ${result.exitCode}. Is it installed? Details: ${result.stderr.trim() || result.stdout.trim().substring(0, 100)}`,
      };
    }

    if (!fs.existsSync(reportPath)) return { scannerName: 'Gitleaks (Secrets)', success: true, durationMs, issues: [] };
    const fileContents = fs.readFileSync(reportPath, 'utf8');
    fs.unlinkSync(reportPath);
    if (!fileContents.trim()) return { scannerName: 'Gitleaks (Secrets)', success: true, durationMs, issues: [] };

    const parsedOutput = JSON.parse(fileContents);
    const raw: Issue[] = Array.isArray(parsedOutput)
      ? parsedOutput.map((leak: any) => ({
          id: leak.RuleID || 'secret-leak',
          severity: 'CRITICAL' as const, // hardcoded secrets are always critical
          message: `Secret detected (${leak.Description || 'Unknown'}): ${leak.Secret ? 'REDACTED' : 'Hidden'}`,
          file: leak.File,
          line: leak.StartLine,
          source: 'Gitleaks',
        }))
      : [];

    // 1) Drop build/dependency artifacts (works even for non-git targets).
    const afterArtifacts = raw.filter((i) => !isBuildArtifactPath(i.file));
    // 2) Drop anything Git ignores (a gitignored .env is the intended home for a secret, not a leak).
    const ignored = await gitIgnoredPaths(
      targetDir,
      [...new Set(afterArtifacts.map((i) => i.file).filter(Boolean) as string[])],
    );
    const issues = afterArtifacts.filter((i) => !i.file || !ignored.has(i.file));

    const dropped = raw.length - issues.length;
    if (dropped > 0) {
      logger.info(`Gitleaks: filtered ${dropped} finding(s) in build artifacts / gitignored paths (kept ${issues.length}).`);
    }

    return { scannerName: 'Gitleaks (Secrets)', success: true, durationMs: Date.now() - startTime, issues };
  } catch (err: any) {
    if (fs.existsSync(reportPath)) { try { fs.unlinkSync(reportPath); } catch { /* already gone */ } }
    return { scannerName: 'Gitleaks (Secrets)', success: false, durationMs: Date.now() - startTime, issues: [], error: err.message };
  }
}

export const gitleaksScanner: Scanner = {
  name: 'Gitleaks (Secrets)',
  module: 'security',
  supportedLanguages: 'all',
  requiredBinaries: ['gitleaks'],
  async run(ctx) {
    const targetDir = ctx.config.scanners.gitleaks?.targetDir || '.';
    return runGitleaks(targetDir);
  },
};
