import { ComponentGraph } from '../../components/types.js';
import { Issue } from '../../types.js';

const SRC = 'Component Evaluator';

/**
 * Coherence checks across the front/back boundary, walking `calls` edges (ApiCall → ApiEndpoint).
 * Flags a client call that sends no auth header to an endpoint whose handler requires auth — the
 * call will 401 at runtime, a front/back contract mismatch.
 */
export function evaluateCrossStack(graph: ComponentGraph): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(graph.nodes.map(n => [n.id, n]));

  for (const edge of graph.edges) {
    if (edge.kind !== 'calls') continue;
    const caller = byId.get(edge.from);
    const target = byId.get(edge.to);
    if (!caller || !target) continue;
    const ca = caller.attributes as any;
    const ta = target.attributes as any;

    if (ta.hasAuthMiddleware && !ca.hasAuthHeader) {
      issues.push({
        id: 'COMP-CROSSSTACK-AUTH-MISMATCH',
        severity: 'MEDIUM',
        message: `${caller.label} (${caller.location.file}) calls ${target.label}, which requires authentication, but sends no Authorization header — this request will be rejected.`,
        file: caller.location.file,
        line: caller.location.line,
        remediation: 'Attach the auth token (Authorization header) to the client call, or relax the endpoint if it is meant to be public.',
        source: SRC,
        category: 'coherence'
      });
    }
  }
  return issues;
}
