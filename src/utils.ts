import { Severity, ScannerResult } from './types.js';

/**
 * Maps varying severity strings from different scanner tools to the unified Severity type.
 */
export function mapSeverity(level: string): Severity {
  if (!level) return 'INFO';
  const norm = level.toUpperCase().trim().split(' ')[0];
  switch (norm) {
    case 'CRITICAL':
    case 'FATAL':
      return 'CRITICAL';
    case 'HIGH':
    case 'ERROR':
      return 'HIGH';
    case 'MEDIUM':
    case 'WARNING':
    case 'WARN':
      return 'MEDIUM';
    case 'LOW':
    case 'INFO':
    case 'INFORMATIONAL':
    case 'STYLE':
      return 'LOW';
    default:
      return 'HIGH';
  }
}

/**
 * Stable fingerprint for an issue: `id::file[:line]`, with leading `./` normalised so the
 * same finding reported by two scanners with differing path prefixes collapses to one.
 */
export function issueFingerprint(issue: { id: string; file?: string; line?: number }): string {
  const file = issue.file ? issue.file.replace(/^\.\//, '') : 'global';
  const line = issue.line ? `:${issue.line}` : '';
  return `${issue.id}::${file}${line}`;
}

/**
 * Deduplicates issues across all scanner results using a global fingerprint set.
 * The first occurrence of a fingerprint wins; later duplicates (e.g. the same CVE found by
 * both Trivy and OSV) are dropped so they don't inflate the summary, score, or gate.
 * Returns new result objects; inputs are not mutated.
 */
export function deduplicateResults(results: ScannerResult[]): ScannerResult[] {
  const seen = new Set<string>();
  return results.map(res => {
    const deduped = res.issues.filter(issue => {
      const fp = issueFingerprint(issue);
      if (seen.has(fp)) return false;
      seen.add(fp);
      return true;
    });
    return { ...res, issues: deduped };
  });
}

// Per-severity weight applied to the (dampened) finding count.
const SEVERITY_WEIGHTS = { critical: 60, high: 25, medium: 8, low: 2 } as const;

/**
 * Calculates the Deployment Readiness Score (0–100).
 *
 * The previous formula was a plain linear subtraction (critical*20, high*10, ...),
 * which was (a) unbounded before clamping — a handful of findings floored it to 0 — and
 * (b) volume-dominated: 20 LOWs sank the score as hard as several CRITICALs, so a large
 * monorepo with cosmetic noise scored the same as a tiny app with a real breach.
 *
 * This version applies a logarithmic dampening (`log2(1 + n)`) to each severity's count,
 * so the *first* finding of a severity carries the most weight and additional findings of
 * the same severity contribute with diminishing returns. Severity still dominates volume
 * (one CRITICAL outweighs many LOWs), and the result is naturally bounded.
 *
 * Note: this score is a health indicator, NOT the gate. The quality gate blocks on the
 * configured `failOn` severities independently of the score.
 */
export function calculateReadinessScore(summary: {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info?: number;
}): number {
  const damp = (n: number) => Math.log2(1 + Math.max(0, n));
  const penalty =
    SEVERITY_WEIGHTS.critical * damp(summary.critical) +
    SEVERITY_WEIGHTS.high * damp(summary.high) +
    SEVERITY_WEIGHTS.medium * damp(summary.medium) +
    SEVERITY_WEIGHTS.low * damp(summary.low);
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

export interface ScoreBand { band: 'green' | 'yellow' | 'red'; meaning: string; }
export interface ScoreBreakdownRow { severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'; count: number; weight: number; penalty: number; }
export interface ScoreExplanation {
  score: number;
  band: ScoreBand['band'];
  bandMeaning: string;
  totalPenalty: number;
  breakdown: ScoreBreakdownRow[];
  formula: string;
}

export function scoreBand(score: number): ScoreBand {
  if (score >= 80) return { band: 'green', meaning: 'Healthy — minor issues only.' };
  if (score >= 50) return { band: 'yellow', meaning: 'Caution — address before the next deploy.' };
  return { band: 'red', meaning: 'Blocked — critical/high findings present.' };
}

/**
 * Explains HOW the readiness score was derived: the per-severity dampened penalty that each
 * severity contributed, the total, and the resulting band. Single source of truth alongside the
 * formula, so every report shows the same math.
 */
export function explainReadinessScore(summary: {
  critical: number; high: number; medium: number; low: number; info?: number;
}): ScoreExplanation {
  const damp = (n: number) => Math.log2(1 + Math.max(0, n));
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const rows: ScoreBreakdownRow[] = [
    { severity: 'CRITICAL', count: summary.critical, weight: SEVERITY_WEIGHTS.critical, penalty: round1(SEVERITY_WEIGHTS.critical * damp(summary.critical)) },
    { severity: 'HIGH', count: summary.high, weight: SEVERITY_WEIGHTS.high, penalty: round1(SEVERITY_WEIGHTS.high * damp(summary.high)) },
    { severity: 'MEDIUM', count: summary.medium, weight: SEVERITY_WEIGHTS.medium, penalty: round1(SEVERITY_WEIGHTS.medium * damp(summary.medium)) },
    { severity: 'LOW', count: summary.low, weight: SEVERITY_WEIGHTS.low, penalty: round1(SEVERITY_WEIGHTS.low * damp(summary.low)) }
  ];
  const totalPenalty = round1(rows.reduce((a, r) => a + r.penalty, 0));
  const score = calculateReadinessScore(summary);
  const { band, meaning } = scoreBand(score);
  return {
    score,
    band,
    bandMeaning: meaning,
    totalPenalty,
    breakdown: rows,
    formula: '100 − Σ ( weight × log₂(1 + count) ) per severity, clamped to 0–100'
  };
}
