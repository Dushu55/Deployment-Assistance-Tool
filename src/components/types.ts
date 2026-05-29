/**
 * Application Component Model (Phase 2).
 *
 * A typed inventory of the things a deployable application is made of — UI controls, API
 * calls, backend endpoints, network resources — captured as a graph so that Phase 3
 * evaluators can reason per-component about fail-safe attributes, robustness, and coherence.
 *
 * V1 extraction is heuristic (regex/structural), consistent with the reachability engine, and
 * is honest about coverage (see `ComponentGraph.coverage`). The schema is intentionally
 * extractor-agnostic so an AST-based implementation can replace the heuristics without changing
 * the graph shape or its consumers.
 */

export const COMPONENT_MODEL_SCHEMA_VERSION = '1.0';

export type ComponentKind =
  | 'UIComponent'
  | 'Input'
  | 'Button'
  | 'Form'
  | 'ApiCall'        // a client-side call OUT to an API (fetch/axios)
  | 'ApiEndpoint'    // a server-side route handler
  | 'NetworkResource'
  | 'AuthBoundary'
  | 'DataStore';

export type EdgeKind =
  | 'contains'   // structural containment (form contains input)
  | 'calls'      // a client ApiCall targets a backend ApiEndpoint
  | 'submits'    // a form/button triggers an ApiCall
  | 'guards';    // an AuthBoundary protects an ApiEndpoint

export interface ComponentLocation {
  file: string;
  line?: number;
}

export interface ComponentNode {
  /** Stable id: `${kind}:${file}:${line}:${index}`. */
  id: string;
  kind: ComponentKind;
  /** Short human label, e.g. `button "Submit"` or `GET /api/users`. */
  label: string;
  location: ComponentLocation;
  /**
   * Kind-specific attributes consumed by Phase 3 fail-safe/robustness checks, e.g.
   * Button: { hasOnClick, disabledControlled, type }
   * Input:  { validation: { required, type, pattern, maxLength } }
   * ApiCall:{ method, url, hasTimeout, hasErrorHandling, hasAuthHeader }
   * ApiEndpoint: { method, path, hasAuthMiddleware }
   * NetworkResource: { openToWorld, ports, ingressCidrs }
   */
  attributes: Record<string, unknown>;
}

export interface ComponentEdge {
  from: string; // node id
  to: string;   // node id
  kind: EdgeKind;
}

export interface CoverageEntry {
  extractor: string;
  filesScanned: number;
  nodesFound: number;
  note: string;
}

export interface ComponentGraph {
  schemaVersion: string;
  generatedAt: string;
  ecosystem: { frontend: string[]; backend: string[]; iac: string[] };
  nodes: ComponentNode[];
  edges: ComponentEdge[];
  coverage: CoverageEntry[];
}

/** Result returned by an individual extractor before assembly/linkage. */
export interface ExtractionResult {
  nodes: ComponentNode[];
  edges: ComponentEdge[];
  coverage: CoverageEntry;
}

export interface Extractor {
  name: string;
  /** Extract components from a workspace root. Implementations must never throw; report partial coverage instead. */
  extract(workspaceRoot: string): ExtractionResult;
}

/** Builds a stable node id. */
export function nodeId(kind: ComponentKind, file: string, line: number, index: number): string {
  return `${kind}:${file.replace(/^\.\//, '')}:${line}:${index}`;
}
