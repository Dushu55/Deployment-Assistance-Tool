import { ComponentGraph } from '../../components/types.js';
import { Issue } from '../../types.js';

const SRC = 'Component Evaluator';

// Endpoints that are public BY DESIGN (you can't require a session to log in). Not flagged for no-auth.
const PUBLIC_AUTH_ENDPOINT = /(^|\/)(login|logout|register|signup|sign-up|signin|sign-in|refresh|callback|session)\b/i;
// Clearly sensitive surfaces where a missing auth check is a serious (gate-blocking) finding. Other
// unauthenticated state-changing endpoints (e.g. a public storefront checkout) are advisory MEDIUM.
const SENSITIVE_PATH = /(^|\/)(admin|internal|manage|superuser|payment|billing|transfer)\b/i;

/** Security checks on backend ApiEndpoint nodes. */
export function evaluateEndpoints(graph: ComponentGraph): Issue[] {
  const issues: Issue[] = [];
  for (const n of graph.nodes) {
    if (n.kind !== 'ApiEndpoint') continue;
    const a = n.attributes as any;
    const path = String(a.path ?? '');

    if (a.isStateChanging && !a.hasAuthMiddleware && !PUBLIC_AUTH_ENDPOINT.test(path)) {
      const sensitive = SENSITIVE_PATH.test(path);
      issues.push({
        id: 'COMP-ENDPOINT-NOAUTH',
        severity: sensitive ? 'HIGH' : 'MEDIUM',
        message: `State-changing endpoint ${n.label} has no detected authentication — confirm it is meant to be public; if not, require authentication before it can mutate state.`,
        file: n.location.file,
        line: n.location.line,
        remediation: 'If this endpoint should be protected, require authentication before mutating state (auth middleware, or verify the session/token in the handler). If it is intentionally public, add rate limiting and strict input validation.',
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
