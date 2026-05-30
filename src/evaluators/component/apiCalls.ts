import { ComponentGraph } from '../../components/types.js';
import { Issue } from '../../types.js';

const SRC = 'Component Evaluator';
const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** Robustness checks on outbound ApiCall nodes (fetch/axios). */
export function evaluateApiCalls(graph: ComponentGraph): Issue[] {
  const issues: Issue[] = [];
  for (const n of graph.nodes) {
    if (n.kind !== 'ApiCall') continue;
    const a = n.attributes as any;

    if (MUTATING.includes(String(a.method)) && !a.hasErrorHandling) {
      issues.push({
        id: 'COMP-APICALL-NO-ERROR-HANDLING',
        severity: 'MEDIUM',
        message: `State-changing API call ${n.label} has no error handling — a failed request fails silently or crashes the UI.`,
        file: n.location.file,
        line: n.location.line,
        remediation: 'Wrap the call in try/catch (or add .catch) and surface the failure to the user; never assume a mutating request succeeds.',
        source: SRC,
        category: 'robustness'
      });
    }

    if (!a.hasTimeout) {
      issues.push({
        id: 'COMP-APICALL-NO-TIMEOUT',
        severity: 'MEDIUM',
        message: `API call ${n.label} has no timeout/abort — a hung upstream can freeze the request indefinitely (availability risk).`,
        file: n.location.file,
        line: n.location.line,
        remediation: 'Pass an AbortController signal (or a timeout) so the call fails fast instead of hanging.',
        source: SRC,
        category: 'robustness'
      });
    }
  }
  return issues;
}
