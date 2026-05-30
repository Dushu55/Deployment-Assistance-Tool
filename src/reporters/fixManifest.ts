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

export const FIX_MANIFEST_SCHEMA_VERSION = '1.0';

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
  status: 'open';
}

export interface FixManifest {
  schemaVersion: string;
  tool: string;
  generatedAt: string;
  gate: { passed: boolean; failOn: Severity[]; readinessScore: number };
  summary: AggregatedReport['summary'];
  coverageGaps: { scanner: string; reason: string }[];
  glossary: ReturnType<typeof buildGlossary>; // explains what every value/score/category means
  findings: FixFinding[];
}

// Map scanner display name -> module so categories follow the scanner taxonomy.
const NAME_TO_MODULE = new Map(ALL_SCANNERS.map(s => [s.name, s.module]));

// IDs that represent missing coverage rather than a concrete defect.
const COVERAGE_IDS = new Set(['NO-LOGIC-TESTS', 'DAST-COVERAGE-GAP', 'LOAD-COVERAGE-GAP', 'NO-URL']);

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
      findings.push({
        findingId: `${res.scannerName}:${issueFingerprint(issue)}`,
        category: issue.category ?? categorize(res.scannerName, issue),
        severity: issue.severity,
        gateBlocking: failOn.includes(issue.severity),
        source: issue.source || res.scannerName,
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
        confidence: 'high', // deterministic scanners; LLM-evaluator findings (Phase 3) will vary this
        status: 'open'
      });
    }
  }

  // Gate-blocking findings first, then by severity, so an agent fixes what unblocks deploy first.
  const order: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  findings.sort((a, b) =>
    (Number(b.gateBlocking) - Number(a.gateBlocking)) ||
    (order.indexOf(a.severity) - order.indexOf(b.severity))
  );

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
