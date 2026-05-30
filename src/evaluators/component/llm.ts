import { ComponentGraph, ComponentNode } from '../../components/types.js';
import { Issue, Severity, FixCategory } from '../../types.js';
import { llmProvider, parseJsonLoose } from '../../llm/index.js';
import { logger } from '../../logger.js';

const SRC = 'Component Evaluator (LLM)';
const VALID_CATEGORIES: FixCategory[] = ['security', 'defect', 'best-practice', 'robustness', 'coherence', 'fail-safe', 'coverage'];
// Components worth the model's attention (security/reliability surface), in priority order.
const PRIORITY: ComponentNode['kind'][] = ['ApiEndpoint', 'NetworkResource', 'ApiCall', 'Form'];

export interface LLMEvalOptions {
  promptFn?: (prompt: string, opts?: any) => Promise<string>; // injectable for tests
  maxComponents?: number;
  allowBlocking?: boolean;
  model?: string;
}

interface RawFinding {
  componentId?: string;
  title?: string;
  severity?: string;
  category?: string;
  rationale?: string;
  evidence?: string;
  confidence?: string;
}

const SYSTEM_INSTRUCTION = `
You are a senior application security and reliability reviewer assessing whether a web application is
enterprise-grade: attack-proof, fail-safe, robust, and coherent.
You are given a JSON list of application components (with their attributes) and the findings a
deterministic rule engine has ALREADY raised. Identify ADDITIONAL robustness / coherence / fail-safe /
security failure modes that the deterministic rules did NOT already cover.
Rules:
- Only report issues you can justify from the provided component attributes/edges. Cite the specific
  attribute or relationship in "evidence". Do NOT speculate beyond the data given.
- Do NOT repeat findings already present in the provided deterministic findings list.
- Return ONLY a JSON array (no prose). Each item:
  { "componentId": string, "title": string, "severity": "HIGH"|"MEDIUM"|"LOW",
    "category": "security"|"robustness"|"coherence"|"fail-safe"|"best-practice",
    "rationale": string, "evidence": string, "confidence": "high"|"medium"|"low" }
- If you find nothing beyond the deterministic findings, return [].
`.trim();

function selectComponents(graph: ComponentGraph, max: number): ComponentNode[] {
  const ranked = [...graph.nodes].sort(
    (a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind)
  ).filter(n => PRIORITY.includes(n.kind));
  return ranked.slice(0, max);
}

function clampSeverity(raw: string | undefined, confidence: string | undefined, allowBlocking: boolean): Severity {
  const up = String(raw || '').toUpperCase();
  const modelSeverity: Severity =
    up === 'CRITICAL' ? 'CRITICAL' : up === 'HIGH' ? 'HIGH' : up === 'LOW' ? 'LOW' : up === 'INFO' ? 'INFO' : 'MEDIUM';
  if (allowBlocking) return modelSeverity;
  // Advisory posture: never exceed MEDIUM; only high-confidence keeps MEDIUM, else demote to LOW.
  if (confidence === 'high') return modelSeverity === 'CRITICAL' || modelSeverity === 'HIGH' ? 'MEDIUM' : modelSeverity === 'INFO' ? 'LOW' : modelSeverity;
  return 'LOW';
}

/**
 * LLM reasoning tier (Phase 3 tier 2). Sends a bounded set of components + the deterministic
 * findings to the model and returns ADDITIONAL robustness/coherence/fail-safe findings. Findings
 * are advisory by default (severity capped at MEDIUM, never block the gate) unless allowBlocking.
 * Never throws — returns [] on any failure or when no backend is configured.
 */
export async function evaluateComponentGraphLLM(
  graph: ComponentGraph,
  deterministic: Issue[],
  opts: LLMEvalOptions = {}
): Promise<Issue[]> {
  const promptFn = opts.promptFn || ((p: string, o?: any) => llmProvider.prompt(p, o));
  if (!opts.promptFn && !llmProvider.isAvailable()) {
    logger.info('LLM evaluator skipped: no Gemini backend configured.');
    return [];
  }

  const max = opts.maxComponents ?? 20;
  const selected = selectComponents(graph, max);
  if (selected.length === 0) return [];
  const omitted = graph.nodes.filter(n => PRIORITY.includes(n.kind)).length - selected.length;
  if (omitted > 0) logger.info(`LLM evaluator: sending ${selected.length} components (${omitted} omitted by maxComponents=${max}).`);

  const byId = new Map(selected.map(n => [n.id, n]));
  const payload = {
    components: selected.map(n => ({ id: n.id, kind: n.kind, label: n.label, file: n.location.file, line: n.location.line, attributes: n.attributes })),
    deterministicFindings: deterministic.map(i => ({ id: i.id, message: i.message, file: i.file, line: i.line }))
  };

  const raw = await promptFn(
    `${SYSTEM_INSTRUCTION}\n\nCOMPONENTS AND EXISTING FINDINGS:\n${JSON.stringify(payload, null, 2)}`,
    { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.1, model: opts.model }
  ).catch((e: any) => { logger.warn(`LLM evaluator call failed: ${e.message}`); return ''; });

  const parsed = parseJsonLoose<RawFinding[]>(raw);
  if (!Array.isArray(parsed)) {
    if (raw) logger.warn('LLM evaluator: response was not a JSON array; ignoring.');
    return [];
  }

  const allowBlocking = opts.allowBlocking === true;
  const issues: Issue[] = [];
  for (const f of parsed) {
    // Guard: evidence required, and componentId must map to a real node.
    if (!f || !f.evidence || !f.componentId) continue;
    const node = byId.get(f.componentId);
    if (!node) continue;

    const category: FixCategory = VALID_CATEGORIES.includes(f.category as FixCategory) ? (f.category as FixCategory) : 'robustness';
    const severity = clampSeverity(f.severity, f.confidence, allowBlocking);
    const title = (f.title || 'LLM finding').toString().slice(0, 120);

    issues.push({
      id: `COMP-LLM-${category.toUpperCase()}`,
      severity,
      message: `${title} — ${node.label}: ${(f.rationale || '').toString().slice(0, 400)} [evidence: ${String(f.evidence).slice(0, 200)}; confidence: ${f.confidence || 'unknown'}]`,
      file: node.location.file,
      line: node.location.line,
      remediation: 'LLM-suggested (advisory): review the cited evidence and address the failure mode; confirm against the deterministic findings.',
      source: SRC,
      category
    });
  }
  return issues;
}
