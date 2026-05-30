import { ComponentGraph } from '../../components/types.js';
import { Issue } from '../../types.js';

const SRC = 'Component Evaluator';

/** Security checks on backend ApiEndpoint nodes. */
export function evaluateEndpoints(graph: ComponentGraph): Issue[] {
  const issues: Issue[] = [];
  for (const n of graph.nodes) {
    if (n.kind !== 'ApiEndpoint') continue;
    const a = n.attributes as any;

    if (a.isStateChanging && !a.hasAuthMiddleware) {
      issues.push({
        id: 'COMP-ENDPOINT-NOAUTH',
        severity: 'HIGH',
        message: `State-changing endpoint ${n.label} has no authentication middleware — it can be invoked by anyone.`,
        file: n.location.file,
        line: n.location.line,
        remediation: 'Require authentication before mutating state (e.g. add requireAuth/isAuthenticated middleware or verify the session/token in the handler).',
        source: SRC,
        category: 'security'
      });
    }

    if (a.method === 'ANY') {
      issues.push({
        id: 'COMP-ENDPOINT-ANY-MUTATING',
        severity: 'HIGH',
        message: `Endpoint ${n.label} accepts ANY HTTP method, so state-changing verbs are reachable via unsafe requests (CSRF / unsafe-GET surface).`,
        file: n.location.file,
        line: n.location.line,
        remediation: 'Restrict the handler to the explicit methods it supports and apply CSRF protection to mutating verbs.',
        source: SRC,
        category: 'security'
      });
    }
  }
  return issues;
}
