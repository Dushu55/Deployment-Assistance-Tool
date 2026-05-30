import { Severity, FixCategory, InputTier } from './types.js';
import { explainReadinessScore } from './utils.js';
import type { ReadinessLevel } from './readiness.js';

/**
 * Single source of truth for what DAT's values MEAN, in plain English for stakeholders.
 * Every report surface (console, HTML, PDF, fix-manifest) pulls explanations from here so the
 * wording never drifts between outputs.
 */

export const SEVERITY_EXPLANATIONS: Record<Severity, { meaning: string; action: string }> = {
  CRITICAL: { meaning: 'An exploitable flaw or breaking defect that puts production at immediate risk.', action: 'Must be fixed before deploying.' },
  HIGH: { meaning: 'A serious security or correctness issue likely to cause harm in production.', action: 'Fix before release; blocks the gate by default.' },
  MEDIUM: { meaning: 'A real weakness that increases risk but is not immediately exploitable.', action: 'Plan a fix soon; advisory by default.' },
  LOW: { meaning: 'A minor or cosmetic issue with limited impact.', action: 'Fix opportunistically.' },
  INFO: { meaning: 'Informational context, not a defect.', action: 'No action required.' }
};

export const CATEGORY_EXPLANATIONS: Record<FixCategory, { label: string; whatItMeans: string; whyItMatters: string }> = {
  security: { label: 'Security', whatItMeans: 'A vulnerability an attacker could exploit.', whyItMatters: 'Directly exposes the application or its data to attack.' },
  defect: { label: 'Defect', whatItMeans: 'The application behaves incorrectly (e.g. a failing test).', whyItMatters: 'Broken logic reaches users and erodes trust.' },
  robustness: { label: 'Robustness', whatItMeans: 'Missing resilience: no timeout, no error handling, no input validation.', whyItMatters: 'The app fails unpredictably under load, bad input, or upstream outages.' },
  coherence: { label: 'Coherence', whatItMeans: 'Components disagree (e.g. a UI call that an endpoint will reject).', whyItMatters: 'Mismatches cause runtime failures that unit tests miss.' },
  'fail-safe': { label: 'Fail-safe', whatItMeans: 'A control lacks a safe default or handled failure path.', whyItMatters: 'When something goes wrong, the app does the unsafe thing.' },
  'best-practice': { label: 'Best practice', whatItMeans: 'Deviation from a hardening or quality convention.', whyItMatters: 'Accumulated drift makes the system harder to secure and maintain.' },
  coverage: { label: 'Coverage gap', whatItMeans: 'A check could not run (missing tool or input), so this area is unverified.', whyItMatters: 'An unverified area is not the same as a safe one.' }
};

export const READINESS_LEVEL_EXPLANATIONS: Record<ReadinessLevel, { title: string; meaning: string; nextStep: string }> = {
  'not-production-safe': { title: '⛔ NOT PRODUCTION-SAFE', meaning: 'Critical inputs or checks are missing — correctness/security is unverified.', nextStep: 'Fix the CRITICAL items to reach Production-Safe.' },
  'production-safe': { title: '🟡 PRODUCTION-SAFE', meaning: 'The security baseline is met, but enterprise-grade hardening gaps remain.', nextStep: 'Close the HIGHLY ADVISED gaps to reach Enterprise-Grade.' },
  'enterprise-grade': { title: '✅ ENTERPRISE-GRADE', meaning: 'Required and recommended inputs are all configured and verified.', nextStep: 'Maintain coverage as the app evolves.' }
};

export const TIER_EXPLANATIONS: Record<InputTier, { label: string; meaning: string }> = {
  critical: { label: 'Critical', meaning: 'Fix before production — active vulnerability, unverified logic, or supply-chain exposure.' },
  'highly-advised': { label: 'Highly advised', meaning: 'Enterprise-grade gaps attackers exploit (infrastructure, ecosystem CVEs, container hardening).' },
  'best-practice': { label: 'Best practice', meaning: 'Maturity gaps that separate a polished product from an MVP.' }
};

export const SCORE_MODEL = {
  range: '0–100 (higher is healthier)',
  bands: [
    { range: '80–100', band: 'green', meaning: 'Healthy — minor issues only.' },
    { range: '50–79', band: 'yellow', meaning: 'Caution — address before the next deploy.' },
    { range: '0–49', band: 'red', meaning: 'Blocked — critical/high findings present.' }
  ],
  weights: { CRITICAL: 60, HIGH: 25, MEDIUM: 8, LOW: 2 },
  formula: '100 − Σ ( weight × log₂(1 + count) ) per severity, clamped to 0–100',
  notes: 'Severity dominates volume (one CRITICAL outweighs many LOWs) and repeated findings of the same severity have diminishing impact. The score is a health indicator — the pass/fail decision is the Quality Gate, not the score.'
};

export const GATE_EXPLANATION =
  'The Quality Gate is the deploy decision. It FAILS when the scan finds any issue at a severity ' +
  'listed in `failOn` (default: CRITICAL, HIGH), or when a scanner errored. Otherwise it PASSES. ' +
  'This is independent of the readiness score.';

export const PIPELINE_OVERVIEW: string[] = [
  'Detect the project ecosystem(s) and select the applicable scanners.',
  'Preflight: verify the app has the inputs needed for a meaningful scan (POC→Enterprise readiness).',
  'Run security/quality/test scanners AND per-component evaluators (fail-safe, robustness, coherence).',
  'Deduplicate findings, compute the readiness score, and evaluate the Quality Gate.',
  'Emit human reports (console / HTML / PDF) and a machine fix-manifest for coding agents (Claude Code).'
];

/** Why the gate passed/failed and which severities drove it. */
export function explainGate(
  failOn: Severity[],
  summary: { critical: number; high: number; medium: number; low: number; info?: number }
): { passed: boolean; blockingSeverities: { severity: Severity; count: number }[]; rationale: string } {
  const counts: Record<Severity, number> = {
    CRITICAL: summary.critical, HIGH: summary.high, MEDIUM: summary.medium, LOW: summary.low, INFO: summary.info ?? 0
  };
  const blocking = failOn
    .map(sev => ({ severity: sev, count: counts[sev] ?? 0 }))
    .filter(x => x.count > 0);
  const passed = blocking.length === 0;
  const rationale = passed
    ? `No findings at the blocking severities (${failOn.join(', ')}). Deployment is permitted.`
    : `Blocked by ${blocking.map(b => `${b.count} ${b.severity}`).join(', ')} finding(s) at the configured failOn severities (${failOn.join(', ')}).`;
  return { passed, blockingSeverities: blocking, rationale };
}

/** Aggregate glossary for embedding in the fix-manifest and templates. */
export function buildGlossary(summary: { critical: number; high: number; medium: number; low: number; info?: number }) {
  return {
    howItWorks: PIPELINE_OVERVIEW,
    score: { model: SCORE_MODEL, thisReport: explainReadinessScore(summary) },
    severities: SEVERITY_EXPLANATIONS,
    categories: CATEGORY_EXPLANATIONS,
    gate: GATE_EXPLANATION,
    readinessLevels: READINESS_LEVEL_EXPLANATIONS
  };
}
