import fs from 'fs';
import { ComponentNode, ComponentEdge, ExtractionResult, Extractor, nodeId } from '../types.js';
import { findFiles, lineAt, relPath } from '../fileScan.js';

const OPEN_CIDRS = ['0.0.0.0/0', '::/0'];

/** Extract the `{ ... }` block body starting at `openIndex` (the index of `{`), brace-matched. */
function blockBody(content: string, openIndex: number): { body: string; end: number } {
  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) return { body: content.slice(openIndex + 1, i), end: i };
    }
  }
  return { body: content.slice(openIndex + 1), end: content.length };
}

function parseCidrs(block: string): string[] {
  const cidrs: string[] = [];
  for (const m of block.matchAll(/cidr_blocks\s*=\s*\[([^\]]*)\]/g)) {
    for (const c of m[1].matchAll(/["']([^"']+)["']/g)) cidrs.push(c[1]);
  }
  return cidrs;
}
function parsePorts(block: string): number[] {
  const from = block.match(/from_port\s*=\s*(\d+)/);
  const to = block.match(/to_port\s*=\s*(\d+)/);
  const ports: number[] = [];
  if (from) ports.push(Number(from[1]));
  if (to && (!from || to[1] !== from[1])) ports.push(Number(to[1]));
  return ports;
}

/**
 * Heuristic Terraform network extractor (AWS V1). Produces NetworkResource nodes for security
 * groups and security-group rules, flagging world-open ingress so Phase 3 can flag
 * non-least-privilege exposure.
 */
export function extractNetworkResources(workspaceRoot: string): ExtractionResult {
  const nodes: ComponentNode[] = [];
  const edges: ComponentEdge[] = [];
  const files = findFiles(workspaceRoot, ['.tf']);
  let index = 0;

  for (const file of files) {
    let content: string;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const rel = relPath(workspaceRoot, file);

    for (const m of content.matchAll(/resource\s+"(aws_security_group(?:_rule)?)"\s+"([^"]+)"\s*\{/g)) {
      const type = m[1];
      const name = m[2];
      const openIdx = content.indexOf('{', m.index!);
      const { body } = blockBody(content, openIdx);
      const line = lineAt(content, m.index!);

      // For a security group, inspect each ingress {} sub-block; for a *_rule, inspect the body directly.
      const ingressBlocks: string[] = [];
      if (type === 'aws_security_group') {
        for (const ing of body.matchAll(/ingress\s*\{/g)) {
          ingressBlocks.push(blockBody(body, body.indexOf('{', ing.index!)).body);
        }
      } else if (/type\s*=\s*["']ingress["']/.test(body)) {
        ingressBlocks.push(body);
      }

      const ingressCidrs = ingressBlocks.flatMap(parseCidrs);
      const ports = Array.from(new Set(ingressBlocks.flatMap(parsePorts)));
      const openToWorld = ingressCidrs.some(c => OPEN_CIDRS.includes(c));

      nodes.push({
        id: nodeId('NetworkResource', rel, line, index++),
        kind: 'NetworkResource',
        label: `${type} "${name}"`,
        location: { file: rel, line },
        attributes: {
          resourceType: type,
          name,
          openToWorld,
          ingressPorts: ports,
          ingressCidrs,
          // Sensitive admin/db ports exposed to the world are the headline least-privilege risk.
          exposesSensitivePort: openToWorld && ports.some(p => [22, 3389, 3306, 5432, 6379, 27017, 9200, 1433].includes(p))
        }
      });
    }
  }

  return {
    nodes,
    edges,
    coverage: {
      extractor: 'network',
      filesScanned: files.length,
      nodesFound: nodes.length,
      note: files.length === 0
        ? 'No Terraform (.tf) files found.'
        : 'Heuristic Terraform parsing (V1): AWS security groups/rules only; variables and modules not resolved.'
    }
  };
}

export const networkExtractor: Extractor = {
  name: 'network',
  extract: extractNetworkResources
};
