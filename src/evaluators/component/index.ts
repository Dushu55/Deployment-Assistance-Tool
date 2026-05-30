import { ComponentGraph } from '../../components/types.js';
import { Issue, ScannerResult } from '../../types.js';
import { evaluateEndpoints } from './endpoints.js';
import { evaluateApiCalls } from './apiCalls.js';
import { evaluateInputs } from './inputs.js';
import { evaluateNetwork } from './network.js';
import { evaluateCrossStack } from './crossStack.js';

/**
 * Phase 3 — Component Evaluators. Runs deterministic per-component rules over the component graph
 * (built in Phase 2) and returns findings as a ScannerResult so they flow through the existing
 * dedup → score → gate → fix-manifest pipeline. Security findings (HIGH/CRITICAL) block the gate;
 * robustness/coherence/fail-safe findings advise.
 */
export function evaluateComponentGraph(graph: ComponentGraph): ScannerResult {
  const startTime = Date.now();
  const issues: Issue[] = [
    ...evaluateEndpoints(graph),
    ...evaluateApiCalls(graph),
    ...evaluateInputs(graph),
    ...evaluateNetwork(graph),
    ...evaluateCrossStack(graph)
  ];
  return {
    scannerName: 'Component Evaluator',
    success: true,
    durationMs: Date.now() - startTime,
    issues
  };
}
