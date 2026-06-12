import { ComponentGraph } from '../../components/types.js';
import { Issue } from '../../types.js';

const SRC = 'Component Evaluator';

/**
 * Coherence checks across the front/back boundary, walking `calls` edges (ApiCall → ApiEndpoint).
 * Flags a client call to an auth-protected endpoint that carries NEITHER an Authorization header NOR
 * cookie-based auth. Same-origin/relative calls and credentials:'include' calls are cookie-authenticated
 * (the browser sends the session cookie automatically) — flagging those produced false "will be rejected"
 * findings, so they are excluded here.
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

    if (ta.hasAuthMiddleware && !ca.hasAuthHeader && !ca.hasCookieAuth) {
      issues.push({
        id: 'COMP-CROSSSTACK-AUTH-MISMATCH',
        severity: 'MEDIUM',
        message: `${caller.label} (${caller.location.file}) calls ${target.label}, which appears to require authentication, but sends no Authorization header and is not a same-origin (cookie-authenticated) call — it may be rejected if the endpoint expects a bearer token.`,
        file: caller.location.file,
        line: caller.location.line,
        remediation: 'If the endpoint uses bearer-token auth, attach the Authorization header; if it uses a session cookie, make the call same-origin or set credentials:"include"; if it is meant to be public, relax the endpoint.',
        source: SRC,
        category: 'coherence'
      });
    }
  }
  return issues;
}
