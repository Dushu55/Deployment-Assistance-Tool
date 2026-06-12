import fs from 'fs';
import path from 'path';
import { AggregatedReport, Severity, Issue, FixCategory } from '../types.js';
import { ALL_SCANNERS } from '../scanners/index.js';
import { issueFingerprint } from '../utils.js';
import { ComponentGraph } from '../components/types.js';
import { locateComponent } from '../components/builder.js';
import { buildGlossary } from '../explain.js';

/**
 * The Fix Manifest is DAT's machine-consumable contract for coding agents (e.g. Claude Code).
 * Unlike SARIF (which is lossy — truncated messages, no structured remediation), this format
 * is designed to be *actioned*: each finding carries enough context (excerpt, rationale,
 * suggested fix, verification command, gate-blocking flag) for an agent to fix it and confirm
 * the fix. See docs/CLAUDE_FIX_PROTOCOL.md for how an agent should consume it.
 */

export const FIX_MANIFEST_SCHEMA_VERSION = '1.1'; // 1.1: + groups, falsePositiveLikelihood, varied confidence, honest security coverageGaps

export type { FixCategory } from '../types.js'; // re-export for back-compat (now defined in types.ts)

export interface FixFinding {
  findingId: string;
  category: FixCategory;
  severity: Severity;
  gateBlocking: boolean;
  source: string;
  title: string;
  rationale: string;
  location: { file: string | null; startLine: number | null; endLine: number | null; excerpt: string | null };
  componentRef: string | null; // id of the owning component in component-model.json (Phase 2), if known
  suggestedFix: string | null;
  verification: { command: string | null };
  dependencies: string[];
  confidence: 'high' | 'medium' | 'low';
  falsePositiveLikelihood: 'low' | 'medium' | 'high'; // raised for findings in test/generated/output files & heuristic checks
  group: string;       // rule/issue id — findings sharing a group can be fixed together (one codemod)
  status: 'open';
}

export interface FixGroup {
  key: string;     // the shared group id (rule id)
  title: string;
  count: number;
  severity: Severity;
  category: FixCategory;
}

export interface FixManifest {
  schemaVersion: string;
  tool: string;
  generatedAt: string;
  gate: { passed: boolean; failOn: Severity[]; readinessScore: number };
  summary: AggregatedReport['summary'];
  coverageGaps: { scanner: string; reason: string }[];
  groups: FixGroup[]; // rule ids occurring more than once — batch these into a single fix
  glossary: ReturnType<typeof buildGlossary>; // explains what every value/score/category means
  findings: FixFinding[];
}

// Map scanner display name -> module so categories follow the scanner taxonomy.
const NAME_TO_MODULE = new Map(ALL_SCANNERS.map(s => [s.name, s.module]));

// IDs that represent missing coverage rather than a concrete defect.
const COVERAGE_IDS = new Set(['NO-LOGIC-TESTS', 'DAST-COVERAGE-GAP', 'LOAD-COVERAGE-GAP', 'NO-URL']);

// Why a not-run, language-agnostic security scanner matters — so coverageGaps is honest about which
// security dimensions were NOT assessed (an empty coverageGaps must mean "everything ran", not "we
// didn't track what was skipped").
const SECURITY_GAP_REASON: Record<string, string> = {
  'OWASP ZAP': 'DAST not run — the deployed app was not probed for runtime/exploitable vulnerabilities.',
  'Gitleaks (Secrets)': 'Secret scanning not run — committed credentials/keys were not checked.',
  'HTTP Security Headers': 'HTTP security-header check not run — header hardening (CSP/HSTS/…) was not assessed.',
  'Trivy': 'Trivy not run — dependency/OS-package CVE scanning was not performed by this engine.',
  'OSV-Scanner': 'OSV-Scanner not run — dependency CVE scanning was not performed by this engine.',
};

/** Confidence that a finding is real & actionable. Deterministic scanners are high; heuristic
 * cross-component inference (coherence) and environmental load findings are lower. */
function confidenceFor(source: string, category: FixCategory, id: string): 'high' | 'medium' | 'low' {
  if (category === 'coherence') return 'low';                          // cross-stack inference — most FP-prone
  const src = source.toLowerCase();
  if (src.includes('component evaluator')) return 'medium';            // heuristic per-component checks
  if (src === 'k6' || /LATENCY|TARGET-UNREACHABLE|LOAD/i.test(id)) return 'medium'; // environmental/target-dependent
  return 'high';                                                       // deterministic SCA/secret/lint w/ file:line
}

/** How likely this finding is a false positive — raised for test/generated/output files & heuristics. */
function fpLikelihood(file: string | null, category: FixCategory): 'low' | 'medium' | 'high' {
  if (file && (/(^|\/)(__tests__|tests?|spec|e2e)(\/|\.)/i.test(file) || /\.(test|spec)\.[tj]sx?$/i.test(file) || /(^|\/)results\//i.test(file))) return 'high';
  if (category === 'coherence') return 'medium';
  return 'low';
}

function categorize(scannerName: string, issue: Issue): FixCategory {
  if (COVERAGE_IDS.has(issue.id)) return 'coverage';
  const module = NAME_TO_MODULE.get(scannerName);
  switch (module) {
    case 'static':
    case 'security':
    case 'llm':
      return 'security';
    case 'container':
      return 'best-practice';
    case 'testing':
      // Failing tests are defects; latency/load findings are robustness.
      if (/LATENCY|LOAD|PERF/i.test(issue.id)) return 'robustness';
      if (/COVERAGE|NO-/i.test(issue.id)) return 'coverage';
      return 'defect';
    default:
      return 'best-practice';
  }
}

// Read a small code excerpt around the finding to give the agent immediate context.
function readExcerpt(file?: string, line?: number, context: number = 3): string | null {
  if (!file || !line) return null;
  try {
    const abs = path.resolve(process.cwd(), file);
    if (!abs.startsWith(process.cwd())) return null; // never read outside the workspace
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    const start = Math.max(0, line - 1 - context);
    const end = Math.min(lines.length, line + context);
    return lines.slice(start, end)
      .map((text, i) => `${start + i + 1}: ${text}`)
      .join('\n');
  } catch {
    return null;
  }
}

export function buildFixManifest(
  report: AggregatedReport,
  options: { verifyCommand?: string | null; failOn?: Severity[]; readinessScore?: number; gatePassed?: boolean; componentGraph?: ComponentGraph } = {}
): FixManifest {
  const failOn = options.failOn ?? ['CRITICAL', 'HIGH'];
  const findings: FixFinding[] = [];
  const coverageGaps: { scanner: string; reason: string }[] = [];

  for (const res of report.results) {
    if (res.skipped) {
      coverageGaps.push({ scanner: res.scannerName, reason: res.skipReason || 'tool unavailable' });
      continue;
    }
    for (const issue of res.issues) {
      if (issue.severity === 'INFO') continue; // INFO is informational; not actionable for an agent
      const category = issue.category ?? categorize(res.scannerName, issue);
      const source = issue.source || res.scannerName;
      findings.push({
        findingId: `${res.scannerName}:${issueFingerprint(issue)}`,
        category,
        severity: issue.severity,
        gateBlocking: failOn.includes(issue.severity),
        source,
        title: `${issue.id}`,
        rationale: issue.message,
        location: {
          file: issue.file ?? null,
          startLine: issue.line ?? null,
          endLine: issue.line ?? null,
          excerpt: readExcerpt(issue.file, issue.line)
        },
        componentRef: options.componentGraph ? locateComponent(options.componentGraph, issue.file, issue.line) : null,
        suggestedFix: issue.remediation ?? null,
        verification: { command: options.verifyCommand ?? null },
        dependencies: [],
        confidence: confidenceFor(source, category, issue.id),
        falsePositiveLikelihood: fpLikelihood(issue.file ?? null, category),
        group: issue.id,
        status: 'open'
      });
    }
  }

  // Honest coverage: record language-agnostic security scanners that did NOT run at all (neither ran
  // nor were skipped-with-a-result), so the manifest never implies a dimension was assessed when it
  // wasn't. (The per-scanner `skipped` gaps above cover tools that were selected but unavailable.)
  const present = new Set(report.results.map(r => r.scannerName));
  for (const s of ALL_SCANNERS) {
    if (present.has(s.name)) continue;
    if (s.module !== 'security' || s.supportedLanguages !== 'all') continue;
    coverageGaps.push({ scanner: s.name, reason: SECURITY_GAP_REASON[s.name] ?? `${s.name} did not run — this security dimension was not assessed.` });
  }

  // Gate-blocking findings first, then by severity, so an agent fixes what unblocks deploy first.
  const order: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  findings.sort((a, b) =>
    (Number(b.gateBlocking) - Number(a.gateBlocking)) ||
    (order.indexOf(a.severity) - order.indexOf(b.severity))
  );

  // Collapse repeated rules into groups so an agent can batch them (e.g. one codemod for 15×
  // "prefer globalThis over window") instead of treating each as a separate task.
  const groupMap = new Map<string, FixGroup>();
  for (const f of findings) {
    const g = groupMap.get(f.group);
    if (g) g.count++;
    else groupMap.set(f.group, { key: f.group, title: f.title, count: 1, severity: f.severity, category: f.category });
  }
  const groups = [...groupMap.values()].filter(g => g.count > 1).sort((a, b) => b.count - a.count);

  return {
    schemaVersion: FIX_MANIFEST_SCHEMA_VERSION,
    tool: 'Deployment Assist Tool (DAT)',
    generatedAt: report.timestamp,
    gate: {
      passed: options.gatePassed ?? false,
      failOn,
      readinessScore: options.readinessScore ?? 0
    },
    summary: report.summary,
    coverageGaps,
    groups,
    glossary: buildGlossary(report.summary),
    findings
  };
}

export function generateFixManifest(
  report: AggregatedReport,
  outputPath: string,
  options: { verifyCommand?: string | null; failOn?: Severity[]; readinessScore?: number; gatePassed?: boolean; componentGraph?: ComponentGraph } = {}
): void {
  const manifest = buildFixManifest(report, options);
  const fullPath = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(manifest, null, 2));
}
