import fs from 'fs';
import { ComponentNode, ComponentEdge, ExtractionResult, Extractor, nodeId } from '../types.js';
import { findFiles, lineAt, relPath } from '../fileScan.js';

const CODE_EXTS = ['.js', '.ts', '.mjs', '.cjs'];
// Identifier hints for authentication. Includes cookie/session-based auth (getSession, verifySession,
// cookies()) — not just bearer-token middleware — so a Next.js route that gates on a session cookie is
// recognised as authenticated instead of being mis-flagged COMP-ENDPOINT-NOAUTH.
const AUTH_HINT = /\b(auth|authenticate|authorize|protect|verifyToken|isAuthenticated|requireLogin|requireAuth|ensureLogged|jwt|passport|getServerSession|getSession|verifySession|requireSession|getToken)\b|cookies\s*\(/i;

// A Next.js edge middleware lives in middleware.ts (or a re-exported proxy.ts) and guards path prefixes.
const MIDDLEWARE_FILE = /(^|[\\/])(middleware|proxy)\.(t|j|mj)s$/i;

/**
 * Heuristic REST endpoint extractor for Express/Fastify-style route registrations and Next.js
 * route handlers. Produces ApiEndpoint nodes with method, path, and an auth-middleware flag
 * (so Phase 3 can flag unauthenticated state-changing endpoints).
 */
export function extractApiEndpoints(workspaceRoot: string): ExtractionResult {
  const nodes: ComponentNode[] = [];
  const edges: ComponentEdge[] = [];
  const files = findFiles(workspaceRoot, CODE_EXTS);
  // Path prefixes guarded by an edge middleware — endpoints under them are authenticated even when the
  // handler itself has no inline auth check.
  const guarded = guardedPrefixesFrom(files);
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
      nodes.push(buildEndpoint(method, routePath, rel, line, index++, AUTH_HINT.test(argsWindow) || underGuardedPrefix(routePath, guarded)));
    }

    // --- Next.js app router: export async function GET(...) in a route.ts ---
    if (/\/route\.(t|j)s$/.test(rel) || /[\\/]route\.(t|j)s$/.test(file)) {
      const routePath = nextAppPath(rel);
      const fileHasAuth = AUTH_HINT.test(content) || underGuardedPrefix(routePath, guarded);
      for (const m of content.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) {
        const line = lineAt(content, m.index!);
        nodes.push(buildEndpoint(m[1], routePath, rel, line, index++, fileHasAuth));
      }
    }

    // --- Next.js pages/api: export default handler ---
    if (/(^|[\\/])pages[\\/]api[\\/]/.test(rel) && /export\s+default\b/.test(content)) {
      const m = content.match(/export\s+default\b/)!;
      const line = lineAt(content, content.indexOf(m[0]));
      const apiPath = nextPagesApiPath(rel);
      nodes.push(buildEndpoint('ANY', apiPath, rel, line, index++, AUTH_HINT.test(content) || underGuardedPrefix(apiPath, guarded)));
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

/**
 * Collect the path prefixes guarded by a Next.js edge middleware (middleware.ts / proxy.ts). We read
 * the `matcher` config and explicit `pathname.startsWith('/...')` / `pathname === '/...'` checks — the
 * standard ways middleware scopes itself — and only when the file actually performs auth. Endpoints
 * under these prefixes are treated as authenticated even with no inline check in the handler.
 */
function guardedPrefixesFrom(files: string[]): string[] {
  const prefixes = new Set<string>();
  for (const file of files) {
    if (!MIDDLEWARE_FILE.test(file.replace(/\\/g, '/'))) continue;
    let content: string;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (!AUTH_HINT.test(content)) continue; // a middleware that doesn't auth doesn't "guard"
    for (const cfg of content.matchAll(/matcher\s*:\s*\[([^\]]*)\]/g))
      for (const lit of cfg[1].matchAll(/["'`]([^"'`]+)["'`]/g)) addGuardedPrefix(prefixes, lit[1]);
    for (const m of content.matchAll(/startsWith\s*\(\s*["'`](\/[^"'`]*)["'`]/g)) addGuardedPrefix(prefixes, m[1]);
    for (const m of content.matchAll(/pathname\s*===\s*["'`](\/[^"'`]*)["'`]/g)) addGuardedPrefix(prefixes, m[1]);
  }
  return [...prefixes];
}

function addGuardedPrefix(set: Set<string>, raw: string): void {
  const p = raw.replace(/[:*()].*$/, '').replace(/\/+$/, ''); // strip Next matcher regex suffixes (/:path*, (.*) …)
  if (!p || p === '/') return;
  // A login/asset path appearing in middleware is not a "guarded API prefix".
  if (/(^|\/)(login|register|signin|sign-in|signup|sign-up|_next|favicon|static|public|assets)\b/i.test(p)) return;
  set.add(normalizePath(p));
}

function underGuardedPrefix(routePath: string, prefixes: string[]): boolean {
  if (prefixes.length === 0) return false;
  const np = normalizePath(routePath);
  return prefixes.some(pre => np === pre || np.startsWith(pre + '/'));
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
