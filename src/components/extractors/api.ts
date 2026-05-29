import fs from 'fs';
import { ComponentNode, ComponentEdge, ExtractionResult, Extractor, nodeId } from '../types.js';
import { findFiles, lineAt, relPath } from '../fileScan.js';

const CODE_EXTS = ['.js', '.ts', '.mjs', '.cjs'];
const AUTH_HINT = /\b(auth|authenticate|authorize|protect|verifyToken|isAuthenticated|requireLogin|requireAuth|ensureLogged|jwt|passport|getServerSession|getToken)\b/i;

/**
 * Heuristic REST endpoint extractor for Express/Fastify-style route registrations and Next.js
 * route handlers. Produces ApiEndpoint nodes with method, path, and an auth-middleware flag
 * (so Phase 3 can flag unauthenticated state-changing endpoints).
 */
export function extractApiEndpoints(workspaceRoot: string): ExtractionResult {
  const nodes: ComponentNode[] = [];
  const edges: ComponentEdge[] = [];
  const files = findFiles(workspaceRoot, CODE_EXTS);
  let index = 0;

  for (const file of files) {
    let content: string;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const rel = relPath(workspaceRoot, file);

    // --- Express / Fastify: app.get('/path', mw, handler) ---
    for (const m of content.matchAll(/\b(app|router|server|fastify|api|route)\s*\.\s*(get|post|put|patch|delete|options|head|all)\s*\(\s*([`'"])([^`'"]+)\3/gi)) {
      const method = m[2].toUpperCase();
      const routePath = m[4];
      const line = lineAt(content, m.index!);
      // Search only the arguments AFTER the path literal, bounded to the current line, so neither
      // the path itself (e.g. /auth/login) nor the next route registration leaks an auth hint.
      const afterPath = m.index! + m[0].length;
      const nl = content.indexOf('\n', afterPath);
      const argsWindow = content.slice(afterPath, nl === -1 ? content.length : nl);
      nodes.push(buildEndpoint(method, routePath, rel, line, index++, AUTH_HINT.test(argsWindow)));
    }

    // --- Next.js app router: export async function GET(...) in a route.ts ---
    if (/\/route\.(t|j)s$/.test(rel) || /[\\/]route\.(t|j)s$/.test(file)) {
      const routePath = nextAppPath(rel);
      const fileHasAuth = AUTH_HINT.test(content);
      for (const m of content.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) {
        const line = lineAt(content, m.index!);
        nodes.push(buildEndpoint(m[1], routePath, rel, line, index++, fileHasAuth));
      }
    }

    // --- Next.js pages/api: export default handler ---
    if (/(^|[\\/])pages[\\/]api[\\/]/.test(rel) && /export\s+default\b/.test(content)) {
      const m = content.match(/export\s+default\b/)!;
      const line = lineAt(content, content.indexOf(m[0]));
      nodes.push(buildEndpoint('ANY', nextPagesApiPath(rel), rel, line, index++, AUTH_HINT.test(content)));
    }
  }

  return {
    nodes,
    edges,
    coverage: {
      extractor: 'api',
      filesScanned: files.length,
      nodesFound: nodes.length,
      note: nodes.length === 0
        ? 'No Express/Fastify/Next route definitions detected.'
        : 'Heuristic route detection (V1): auth-middleware inferred by identifier hints; dynamic route registration not traced.'
    }
  };
}

function buildEndpoint(method: string, path: string, file: string, line: number, index: number, hasAuth: boolean): ComponentNode {
  return {
    id: nodeId('ApiEndpoint', file, line, index),
    kind: 'ApiEndpoint',
    label: `${method} ${path}`,
    location: { file, line },
    attributes: {
      method,
      path: normalizePath(path),
      hasAuthMiddleware: hasAuth,
      isStateChanging: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    }
  };
}

// Normalise route params so '/api/users/:id' and '/api/users/[id]' compare equal to client calls.
export function normalizePath(p: string): string {
  return p
    .replace(/\[([^\]]+)\]/g, ':param')   // Next dynamic segment [id] -> :param
    .replace(/:[A-Za-z0-9_]+/g, ':param') // Express :id -> :param
    .replace(/\/+$/, '') || '/';
}

function nextAppPath(rel: string): string {
  // app/api/users/[id]/route.ts -> /api/users/[id]
  const m = rel.replace(/\\/g, '/').match(/(?:^|\/)app\/(.*)\/route\.(t|j)s$/);
  return '/' + (m ? m[1] : rel.replace(/\/route\.(t|j)s$/, ''));
}
function nextPagesApiPath(rel: string): string {
  // pages/api/users/[id].ts -> /api/users/[id]
  const m = rel.replace(/\\/g, '/').match(/(?:^|\/)pages\/(api\/.*)\.(t|j)sx?$/);
  return '/' + (m ? m[1].replace(/\/index$/, '') : rel);
}

export const apiExtractor: Extractor = {
  name: 'api',
  extract: extractApiEndpoints
};
