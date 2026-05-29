import fs from 'fs';
import path from 'path';
import {
  ComponentGraph, ComponentNode, ComponentEdge, CoverageEntry,
  COMPONENT_MODEL_SCHEMA_VERSION
} from './types.js';
import { reactExtractor } from './extractors/react.js';
import { apiExtractor } from './extractors/api.js';
import { networkExtractor } from './extractors/network.js';
import { normalizePath } from './extractors/api.js';

const EXTRACTORS = [reactExtractor, apiExtractor, networkExtractor];

/** Reduce a client call URL to a comparable route path: strip origin & query, collapse params. */
export function normalizeCallPath(url: string | null): string | null {
  if (!url) return null;
  let p = url.replace(/^[a-z]+:\/\/[^/]+/i, ''); // strip protocol+host
  p = p.split('?')[0].split('#')[0];
  if (!p.startsWith('/')) p = '/' + p;
  // Collapse numeric ids and ${...}/:params/[id] segments to the endpoint's :param token.
  p = p
    .replace(/\$\{[^}]*\}/g, ':param')
    .replace(/\/\d+(?=\/|$)/g, '/:param');
  return normalizePath(p);
}

/** Link client ApiCall nodes to backend ApiEndpoint nodes by normalized path + method. */
export function linkCallsToEndpoints(nodes: ComponentNode[]): ComponentEdge[] {
  const endpoints = nodes.filter(n => n.kind === 'ApiEndpoint');
  const edges: ComponentEdge[] = [];
  for (const call of nodes.filter(n => n.kind === 'ApiCall')) {
    const callPath = normalizeCallPath(call.attributes.url as string | null);
    if (!callPath) continue;
    const callMethod = String(call.attributes.method || 'GET').toUpperCase();
    for (const ep of endpoints) {
      const epMethod = String(ep.attributes.method || 'ANY').toUpperCase();
      if (ep.attributes.path === callPath && (epMethod === callMethod || epMethod === 'ANY')) {
        edges.push({ from: call.id, to: ep.id, kind: 'calls' });
      }
    }
  }
  return edges;
}

export function buildComponentModel(
  workspaceRoot: string,
  options: { timestamp: string; detectedLanguages?: string[] }
): ComponentGraph {
  const nodes: ComponentNode[] = [];
  const edges: ComponentEdge[] = [];
  const coverage: CoverageEntry[] = [];

  for (const extractor of EXTRACTORS) {
    let result;
    try {
      result = extractor.extract(workspaceRoot);
    } catch (err) {
      coverage.push({ extractor: extractor.name, filesScanned: 0, nodesFound: 0, note: `Extractor errored: ${(err as Error).message}` });
      continue;
    }
    nodes.push(...result.nodes);
    edges.push(...result.edges);
    coverage.push(result.coverage);
  }

  // Cross-stack linkage: which UI calls hit which backend endpoints.
  edges.push(...linkCallsToEndpoints(nodes));

  const has = (k: string) => nodes.some(n => n.kind === k);
  return {
    schemaVersion: COMPONENT_MODEL_SCHEMA_VERSION,
    generatedAt: options.timestamp,
    ecosystem: {
      frontend: (has('Button') || has('Input') || has('Form') || has('ApiCall')) ? ['react'] : [],
      backend: has('ApiEndpoint') ? ['rest'] : [],
      iac: has('NetworkResource') ? ['terraform'] : []
    },
    nodes,
    edges,
    coverage
  };
}

export function writeComponentModel(graph: ComponentGraph, outputPath: string): void {
  const full = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(graph, null, 2));
}

/**
 * Best-effort: find the component a finding belongs to — the nearest node in the same file
 * at or before the finding's line. Used to set `componentRef` on fix-manifest findings.
 */
export function locateComponent(graph: ComponentGraph, file?: string, line?: number): string | null {
  if (!file) return null;
  const norm = file.replace(/^\.\//, '');
  const candidates = graph.nodes.filter(n => n.location.file === norm);
  if (candidates.length === 0) return null;
  if (line == null) return candidates[0].id;
  let best: ComponentNode | null = null;
  for (const n of candidates) {
    const nl = n.location.line ?? 0;
    if (nl <= line && (!best || nl > (best.location.line ?? 0))) best = n;
  }
  return (best ?? candidates[0]).id;
}
