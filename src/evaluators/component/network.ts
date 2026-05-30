import { ComponentGraph } from '../../components/types.js';
import { Issue } from '../../types.js';

const SRC = 'Component Evaluator';

/** Least-privilege checks on NetworkResource nodes (Terraform security groups). */
export function evaluateNetwork(graph: ComponentGraph): Issue[] {
  const issues: Issue[] = [];
  for (const n of graph.nodes) {
    if (n.kind !== 'NetworkResource') continue;
    const a = n.attributes as any;
    const ports = Array.isArray(a.ingressPorts) ? a.ingressPorts.join(', ') : '';

    if (a.exposesSensitivePort) {
      issues.push({
        id: 'COMP-NET-SENSITIVE-PORT',
        severity: 'CRITICAL',
        message: `${n.label} exposes a sensitive admin/database port (${ports}) to the public internet (0.0.0.0/0).`,
        file: n.location.file,
        line: n.location.line,
        remediation: 'Restrict ingress to known CIDRs / a bastion / VPC; never expose SSH/RDP/DB ports to 0.0.0.0/0.',
        source: SRC,
        category: 'security'
      });
    } else if (a.openToWorld) {
      issues.push({
        id: 'COMP-NET-OPEN-WORLD',
        severity: 'MEDIUM',
        message: `${n.label} allows ingress from the entire internet (0.0.0.0/0) on port(s) ${ports || 'unspecified'}.`,
        file: n.location.file,
        line: n.location.line,
        remediation: 'Scope ingress CIDRs to the minimum required ranges; reserve 0.0.0.0/0 for genuinely public ports (80/443) behind a WAF/LB.',
        source: SRC,
        category: 'security'
      });
    }
  }
  return issues;
}
